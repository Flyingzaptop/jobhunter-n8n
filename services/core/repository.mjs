import pg from "pg";
import { randomUUID } from "node:crypto";
import {operationContext} from './observability.mjs';
import { readFile, readdir } from "node:fs/promises";
const leanJobColumns=`j.job_id,j.canonical_url,j.application_url,j.company,j.title,j.location,j.country,j.work_mode,
 j.description_text,j.content_hash,j.availability_status,j.first_seen_at,j.last_seen_at,
 j.metadata->>'identity_key' identity_key,j.metadata->>'ats_identity' ats_identity,coalesce(j.metadata->>'profile','real') profile,
 j.metadata->'employment_type' employment_type,j.metadata->>'published_at' published_at,j.metadata->>'valid_through' valid_through,j.metadata->'salary' salary`;
const relevanceFields={title:'title',company:'company',description:'description_text',location:'location',country:'country',work_mode:'work_mode',canonical_url:'canonical_url',application_url:'application_url',availability:'availability_status'};
const relevanceParts=Object.entries(relevanceFields).map(([key,column])=>`'${JSON.stringify(key)}:'||COALESCE(to_json(j.${column})::text,'null')`).join("||','||");
const currentRelevanceHashSql=`encode(sha256(convert_to('{'||${relevanceParts}||'}','UTF8')),'hex')`;
export class Repository {
  constructor(connectionString = process.env.DATABASE_URL, {max = 5} = {}) {
    if (!connectionString) throw new Error("DATABASE_URL required");
    if(!Number.isInteger(max)||max<1||max>50)throw new Error('INVALID_DATABASE_POOL_SIZE');
    this.pool = new pg.Pool({ connectionString, max });
  }
  async migrate() {
    const client=await this.pool.connect();let locked=false;
    try {
      await client.query("SELECT pg_advisory_lock(hashtext('jobhunter.migrations'),hashtext(current_database()||':'||current_schema()))");
      locked=true;
      for (const name of (await readdir("db/migrations"))
        .filter((n) => n.endsWith(".sql"))
        .sort())
        await client.query(await readFile(`db/migrations/${name}`, "utf8"));
    } finally {
      try {if(locked)await client.query("SELECT pg_advisory_unlock(hashtext('jobhunter.migrations'),hashtext(current_database()||':'||current_schema()))");}
      finally {client.release();}
    }
  }
  async insertRaw(raw) {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO jobs_raw(raw_id,source_name,source_item_id,source_url,payload_json,ingestion_run_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_name,source_item_id,source_url) DO UPDATE SET payload_json=EXCLUDED.payload_json RETURNING *`,
      [
        id,
        raw.source_name,
        raw.source_item_id,
        raw.source_url,
        raw,
        raw.ingestion_run_id ?? null,
      ],
    );
    return { ...rows[0].payload_json, ...rows[0] };
  }
  async listRaw() {
    const { rows } = await this.pool.query(
      "SELECT * FROM jobs_raw ORDER BY discovered_at",
    );
    return rows.map((r) => ({ ...r.payload_json, ...r }));
  }
  async listCanonicalJobs() {
    return (
      await this.pool.query("SELECT * FROM jobs ORDER BY first_seen_at")
    ).rows.map((row) => ({ ...row.metadata, ...row }));
  }
  async listReadinessJobs(){
    return (await this.pool.query(`SELECT job_id,canonical_url,application_url,company,title,location,country,work_mode,
      content_hash,availability_status,last_verified_open_at FROM jobs
      WHERE COALESCE(metadata->>'test_fixture','false')<>'true' AND COALESCE(metadata->>'mode','REAL')<>'MOCK'`)).rows;
  }
  async readinessCoverage(jobIds,version){
    return (await this.pool.query(`SELECT count(*)::int n FROM relevance_queue q JOIN jobs j USING(job_id)
      WHERE q.job_id=ANY($1::uuid[]) AND q.relevance_version=$2 AND q.input_hash=${currentRelevanceHashSql}`,[jobIds,version])).rows[0].n;
  }
  async listRelevanceChanges(version){return (await this.pool.query(`SELECT ${leanJobColumns} FROM jobs j LEFT JOIN relevance_queue q USING(job_id)
   WHERE coalesce(j.metadata->>'profile','real')='real' AND (q.job_id IS NULL OR q.relevance_version<>$1 OR q.input_hash<>${currentRelevanceHashSql})`,[version])).rows;}
  async listHardGateJobs(profileHash,policyHash,jobIds){return (await this.pool.query(`SELECT ${leanJobColumns} FROM jobs j LEFT JOIN relevance_queue q USING(job_id)
   WHERE coalesce(j.metadata->>'profile','real')='real' AND (q.job_id IS NULL OR q.status NOT IN('LOW_PRIORITY','CLOSED'))
   AND ($3::uuid[] IS NULL OR j.job_id=ANY($3::uuid[])) AND NOT EXISTS(SELECT 1 FROM job_analysis h WHERE h.job_id=j.job_id
    AND h.analysis_json->>'analysis_method'='DETERMINISTIC_HARD_GATE' AND h.analysis_json->>'profile_hash'=$1
    AND h.analysis_json->>'policy_hash'=$2 AND h.analysis_json->>'hard_gate_job_input_hash'=q.input_hash)`,[profileHash,policyHash,jobIds??null])).rows;}
  async readinessFitJobs(jobIds){return (await this.pool.query('SELECT job_id,title,company,description_text,location,country,work_mode,canonical_url,application_url,availability_status FROM jobs WHERE job_id=ANY($1::uuid[])',[jobIds])).rows;}
  async listNormalizationJobs(){
    return (await this.pool.query(`SELECT job_id,canonical_url,application_url,company,title,location,country,work_mode,
      description_text,content_hash,availability_status,first_seen_at,last_seen_at,metadata->>'identity_key' AS identity_key,
      metadata->>'ats_identity' AS ats_identity,coalesce(metadata->>'profile','real') AS profile,
      metadata->'employment_type' AS employment_type,metadata->>'published_at' AS published_at,
      metadata->>'valid_through' AS valid_through,metadata->'salary' AS salary FROM jobs`)).rows;
  }
  async listNormalizationIndexJobs(){return (await this.pool.query(`SELECT ${leanJobColumns.replace('j.description_text,','')},char_length(j.description_text) description_length FROM jobs j`)).rows;}
  async normalizationDescriptions(jobIds){return (await this.pool.query('SELECT job_id,description_text FROM jobs WHERE job_id=ANY($1::uuid[])',[jobIds])).rows;}
  async upsertCanonicalJob(job, { source }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const id = job.job_id ?? randomUUID();
      const { rows } = await client.query(
        `INSERT INTO jobs(job_id,canonical_url,application_url,company,title,location,country,work_mode,description_text,content_hash,availability_status,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(canonical_url) DO UPDATE SET last_seen_at=now(),description_text=EXCLUDED.description_text,content_hash=EXCLUDED.content_hash,metadata=EXCLUDED.metadata,availability_status=EXCLUDED.availability_status,application_url=EXCLUDED.application_url,work_mode=EXCLUDED.work_mode,country=EXCLUDED.country,title=EXCLUDED.title,company=EXCLUDED.company,location=EXCLUDED.location RETURNING *, (xmax=0) AS is_new`,
        [
          id,
          job.canonical_url,
          job.application_url ?? job.canonical_url,
          job.company,
          job.title,
          job.location,
          job.country,
          job.work_mode,
          job.description_text ?? "",
          job.content_hash,
          job.availability_status ?? "UNKNOWN",
          job,
        ],
      );
      const row = rows[0];
      await client.query(
        `INSERT INTO job_sources(job_id,source_name,source_url,source_item_id) VALUES($1,$2,$3,$4) ON CONFLICT(job_id,source_name,source_url) DO UPDATE SET last_seen_at=now()`,
        [
          row.job_id,
          source.source_name,
          source.source_url,
          source.source_item_id,
        ],
      );
      await client.query("COMMIT");
      return { job_id: row.job_id, is_new: row.is_new };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async saveAnalysis(jobId, a) {
    await this.pool.query(
      `INSERT INTO job_analysis(analysis_id,job_id,model,prompt_version,profile_version,overall_fit,application_priority,decision,analysis_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        jobId,
        a.model ?? process.env.LLM_FAST_MODEL ?? "UNKNOWN",
        a.prompt_version ?? "v1",
        a.profile_version ?? "v1",
        a.overall_fit,
        a.application_priority,
        a.decision,
        a,
      ],
    );
  }
  async event(type, id, event, payload = {}) {
    const context=operationContext.getStore();
    const contextual=context?{...payload,run_id:context.run_id,stage:context.stage}:payload;
    await this.pool.query(
      "INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), type, id, event, contextual],
    );
  }
  async recordCvDraft(manifest){await this.pool.query(`INSERT INTO cv_drafts(cv_id,job_id,status,manifest_json) VALUES($1,$2,$3,$4) ON CONFLICT(cv_id) DO UPDATE SET status=EXCLUDED.status,manifest_json=EXCLUDED.manifest_json`,[manifest.cv_id,manifest.job_id,manifest.status,manifest]);}
  async close() {
    await this.pool.end();
  }
}
