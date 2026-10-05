import {createHash} from 'node:crypto';import {ContinuousStore,cvWorkKey} from './continuous-worker.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function llmTaskReport({repository,profile,policy}){
 const store=new ContinuousStore(repository),[fit,summary,cvDone,lanes,current,prose,applications]=await Promise.all([
  repository.pool.query(`SELECT q.status,count(*)::int count,count(*) FILTER(WHERE q.next_retry_at IS NULL OR q.next_retry_at<=now())::int due FROM relevance_queue q GROUP BY q.status`),
  repository.pool.query(`WITH latest AS(SELECT DISTINCT ON(job_id) job_id,overall_fit,(analysis_json->>'fit_elapsed_ms')::numeric elapsed_ms FROM job_analysis WHERE analysis_json->>'analysis_method'='GEMMA_SINGLE_SCORE' AND analysis_json->>'profile_hash'=$1 AND analysis_json->>'policy_hash'=$2 ORDER BY job_id,created_at DESC,analysis_id DESC) SELECT count(*)::int done,count(*) FILTER(WHERE overall_fit<45)::int rejected,count(*) FILTER(WHERE overall_fit>=45)::int accepted,round(avg(overall_fit),1) average_fit,round(avg(elapsed_ms)/1000,2) avg_model_seconds FROM latest`,[hash(profile),hash(policy)]),
  repository.pool.query("SELECT count(DISTINCT job_id)::int done FROM cv_versions WHERE profile_version=$1 AND qa_json->>'pass'='true'",[hash(profile)]),
  repository.pool.query('SELECT lane,state,outcome_code,updated_at FROM continuous_worker_status ORDER BY lane'),
  repository.pool.query(`SELECT 'FIT' task,j.title,j.company,q.claimed_at started_at FROM relevance_queue q JOIN jobs j USING(job_id) WHERE q.status='RUNNING' UNION ALL SELECT 'CV',j.title,j.company,w.updated_at FROM continuous_work w JOIN jobs j ON j.job_id=w.entity_id JOIN continuous_worker_status s ON s.owner_id=w.owner_id AND s.lane='model' WHERE w.lane='cv' AND w.status='RUNNING' LIMIT 5`),
  repository.pool.query('SELECT status,count(*)::int count FROM application_prose_drafts GROUP BY status'),
  repository.pool.query('SELECT status,count(*)::int count FROM applications GROUP BY status')]);
 const candidates=await store.cvCandidates(profile,policy),runnable=await store.runnableCvCandidates(profile,policy);
 const pendingFit=await store.pendingFitCount(profile,policy),ready=pendingFit>0;
 return {updated_at:new Date().toISOString(),priority_order:['FIT','CV','FILL'],next_priority:ready?'FIT':runnable.length?'CV':'FILL',current:current.rows,
  fit:{queue:fit.rows,ready_hint:pendingFit,deferred:fit.rows.reduce((n,r)=>n+r.count-r.due,0),...summary.rows[0]},
  cv:{pending:candidates.length,runnable:runnable.length,done:cvDone.rows[0].done,top:candidates.slice(0,20).map(j=>({job_id:j.job_id,title:j.title,company:j.company,fit:j.analysis_json.overall_fit,work_key:cvWorkKey(j,j.analysis_json,profile)}))},
  fill:{queue:applications.rows,prose:prose.rows},lanes:lanes.rows,notes:['Done FIT counts are current-profile Gemma scores; rule-only filtering is separate.','Deferred retries and user waits are not runnable work.']};
}
