import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
export class Repository {
 constructor(connectionString=process.env.DATABASE_URL) { if(!connectionString) throw new Error('DATABASE_URL required'); this.pool=new pg.Pool({connectionString,max:5}); }
 async migrate(){ for(const name of (await readdir('db/migrations')).filter(n=>n.endsWith('.sql')).sort()) await this.pool.query(await readFile(`db/migrations/${name}`,'utf8')); }
 async insertRaw(raw){ const id=randomUUID(); const {rows}=await this.pool.query(`INSERT INTO jobs_raw(raw_id,source_name,source_item_id,source_url,payload_json,ingestion_run_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_name,source_item_id,source_url) DO UPDATE SET payload_json=EXCLUDED.payload_json RETURNING *`,[id,raw.source_name,raw.source_item_id,raw.source_url,raw,raw.ingestion_run_id??null]); return {...rows[0].payload_json,...rows[0]}; }
 async listRaw(){const {rows}=await this.pool.query('SELECT * FROM jobs_raw ORDER BY discovered_at'); return rows.map(r=>({...r.payload_json,...r}));}
 async listCanonicalJobs(){return (await this.pool.query('SELECT * FROM jobs ORDER BY first_seen_at')).rows.map(row=>({...row.metadata,...row}));}
 async upsertCanonicalJob(job,{source}) {
  const client=await this.pool.connect(); try {await client.query('BEGIN');
   const id=job.job_id??randomUUID(); const {rows}=await client.query(`INSERT INTO jobs(job_id,canonical_url,application_url,company,title,location,country,work_mode,description_text,content_hash,availability_status,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(canonical_url) DO UPDATE SET last_seen_at=now(),description_text=EXCLUDED.description_text,content_hash=EXCLUDED.content_hash,metadata=EXCLUDED.metadata,availability_status=EXCLUDED.availability_status,application_url=EXCLUDED.application_url,work_mode=EXCLUDED.work_mode,country=EXCLUDED.country,title=EXCLUDED.title,company=EXCLUDED.company,location=EXCLUDED.location RETURNING *, (xmax=0) AS is_new`,[id,job.canonical_url,job.application_url??job.canonical_url,job.company,job.title,job.location,job.country,job.work_mode,job.description_text??'',job.content_hash,job.availability_status??'UNKNOWN',job]);
   const row=rows[0]; await client.query(`INSERT INTO job_sources(job_id,source_name,source_url,source_item_id) VALUES($1,$2,$3,$4) ON CONFLICT(job_id,source_name,source_url) DO UPDATE SET last_seen_at=now()`,[row.job_id,source.source_name,source.source_url,source.source_item_id]); await client.query('COMMIT'); return {job_id:row.job_id,is_new:row.is_new};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 async saveAnalysis(jobId,a){await this.pool.query(`INSERT INTO job_analysis(analysis_id,job_id,model,prompt_version,profile_version,overall_fit,application_priority,decision,analysis_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[randomUUID(),jobId,a.model??process.env.LLM_FAST_MODEL??'UNKNOWN',a.prompt_version??'v1',a.profile_version??'v1',a.overall_fit,a.application_priority,a.decision,a]);}
 async event(type,id,event,payload={}){await this.pool.query('INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json) VALUES($1,$2,$3,$4,$5)',[randomUUID(),type,id,event,payload]);}
 async close(){await this.pool.end();}
}

