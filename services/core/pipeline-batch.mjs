import {createHash,randomUUID} from 'node:crypto';import {normalizeRaw,duplicateConfidence} from './normalization.mjs';import {RELEVANCE_VERSION} from './relevance-queue.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export async function startFrozenBatch(repository){
 const client=await repository.pool.connect();try{await client.query('BEGIN');await client.query('UPDATE pipeline_batches SET active=false WHERE active=true');const id=randomUUID();await client.query('INSERT INTO pipeline_batches(batch_id)VALUES($1)',[id]);
 await client.query(`INSERT INTO pipeline_batch_raw(batch_id,raw_id,status,job_id) SELECT $1,r.raw_id,CASE WHEN s.job_id IS NULL THEN 'PENDING' ELSE 'NORMALIZED' END,s.job_id FROM jobs_raw r LEFT JOIN LATERAL(SELECT job_id FROM job_sources s WHERE s.source_name=r.source_name AND s.source_url=r.source_url AND(r.source_item_id IS NULL OR s.source_item_id=r.source_item_id) LIMIT 1)s ON true`,[id]);
 await client.query('INSERT INTO pipeline_batch_jobs SELECT $1,job_id FROM jobs',[id]);await client.query('COMMIT');return id;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
export async function finishBatchNormalization(repository,batchId){
 const rows=(await repository.pool.query("SELECT r.* FROM pipeline_batch_raw b JOIN jobs_raw r USING(raw_id) WHERE b.batch_id=$1 AND b.status='PENDING' LIMIT 100",[batchId])).rows;
 for(const row of rows){try{const raw={...row.payload_json,...row},job=normalizeRaw(raw),candidates=(await repository.pool.query('SELECT * FROM jobs WHERE canonical_url=$1 OR(lower(company)=lower($2) AND lower(title)=lower($3)) LIMIT 25',[job.canonical_url,job.company,job.title])).rows;
 const duplicate=candidates.map(c=>({candidate:{...c.metadata,...c},match:duplicateConfidence(job,{...c.metadata,...c})})).find(c=>c.match);
 if(duplicate){job.job_id=duplicate.candidate.job_id;job.canonical_url=duplicate.candidate.canonical_url;}
 const saved=await repository.upsertCanonicalJob(job,{source:raw,duplicate_signal:duplicate?.match??null});await repository.pool.query("UPDATE pipeline_batch_raw SET status='NORMALIZED',job_id=$3 WHERE batch_id=$1 AND raw_id=$2",[batchId,row.raw_id,saved.job_id]);await repository.pool.query('INSERT INTO pipeline_batch_jobs VALUES($1,$2)ON CONFLICT DO NOTHING',[batchId,saved.job_id]);
 }catch(e){if(e.code)throw e;await repository.pool.query("UPDATE pipeline_batch_raw SET status='REJECTED_INVALID_RAW',error_code=$3 WHERE batch_id=$1 AND raw_id=$2",[batchId,row.raw_id,String(e.message).split('\n')[0].slice(0,200)]);}}
 return rows.length;
}
async function calculateBatchProgress(repository,profile,policy){
 const batch=(await repository.pool.query('SELECT * FROM pipeline_batches WHERE active=true')).rows[0];if(!batch)return null;
 const [raw,screen,fit,cv,fill]=await Promise.all([
 repository.pool.query("SELECT count(*)::int total,count(*) FILTER(WHERE status IN('NORMALIZED','REJECTED_INVALID_RAW'))::int done,count(*) FILTER(WHERE status='REJECTED_INVALID_RAW')::int rejected FROM pipeline_batch_raw WHERE batch_id=$1",[batch.batch_id]),
 repository.pool.query('SELECT count(*)::int total,count(*) FILTER(WHERE q.relevance_version=$2)::int done FROM pipeline_batch_jobs b LEFT JOIN relevance_queue q USING(job_id) WHERE b.batch_id=$1',[batch.batch_id,RELEVANCE_VERSION]),
 repository.pool.query(`SELECT count(*)::int total,count(*) FILTER(WHERE q.status='CLOSED' OR EXISTS(SELECT 1 FROM job_analysis a WHERE a.job_id=b.job_id AND a.analysis_json->>'profile_hash'=$2 AND a.analysis_json->>'policy_hash'=$3 AND a.analysis_json->>'job_content_hash'=j.content_hash))::int done,count(*) FILTER(WHERE q.status IN('OPEN_UNVERIFIED','RETRY','DEAD_LETTER'))::int blocked,count(*) FILTER(WHERE q.status='RUNNING')::int running,count(*) FILTER(WHERE q.status='OPEN_UNVERIFIED')::int waiting_access,count(*) FILTER(WHERE q.status='DEAD_LETTER')::int failed,min(q.next_retry_at) FILTER(WHERE q.next_retry_at>now()) next_retry_at FROM pipeline_batch_jobs b JOIN jobs j USING(job_id) JOIN relevance_queue q USING(job_id) WHERE b.batch_id=$1 AND q.status NOT IN('LOW_PRIORITY')`,[batch.batch_id,hash(profile),hash(policy)]),
 repository.pool.query(`SELECT (SELECT count(DISTINCT c.job_id)::int FROM cv_versions c JOIN pipeline_batch_jobs b USING(job_id) WHERE b.batch_id=$1 AND c.profile_version=$2 AND c.qa_json->>'pass'='true') done,(SELECT count(*)::int FROM pipeline_batch_jobs b JOIN LATERAL(SELECT overall_fit,decision,analysis_json FROM job_analysis a WHERE a.job_id=b.job_id ORDER BY created_at DESC,analysis_id DESC LIMIT 1)a ON true WHERE b.batch_id=$1 AND a.overall_fit>=45 AND a.decision IN('REVIEW','STRETCH','AUTO_APPLY') AND a.analysis_json->>'profile_hash'=$2 AND a.analysis_json->>'policy_hash'=$3) total`,[batch.batch_id,hash(profile),hash(policy)]),
 repository.pool.query('SELECT status,count(*)::int count FROM applications a JOIN pipeline_batch_jobs b USING(job_id) WHERE b.batch_id=$1 GROUP BY status',[batch.batch_id])]);
 const normalized=raw.rows[0].done===raw.rows[0].total&&screen.rows[0].done===screen.rows[0].total;
 const fitted=normalized&&fit.rows[0].done===fit.rows[0].total;
 return {batch_id:batch.batch_id,discovery_paused:batch.discovery_paused,phase:!normalized?'NORMALIZE':!fitted?'FIT':'CV_HITL',normalization:{...raw.rows[0],screen:screen.rows[0]},fit:fit.rows[0],cv:cv.rows[0],applications:fill.rows};
}

const batchCache=new WeakMap();
export async function batchProgress(repository,profile,policy){const key=hash([profile,policy]),entry=batchCache.get(repository);if(entry?.key===key&&Date.now()-entry.at<15000)return entry.value;if(entry?.pending&&entry.key===key)return entry.pending;const state={key,at:0,value:null,pending:null};state.pending=calculateBatchProgress(repository,profile,policy).then(value=>{state.value=value;state.at=Date.now();state.pending=null;return value;}).catch(error=>{batchCache.delete(repository);throw error;});batchCache.set(repository,state);return state.pending;}
