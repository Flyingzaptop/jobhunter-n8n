import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Old scalar FIT runs recorded ANALYZED even when their own location result was
// UNVERIFIED. Preserve their score/evidence and expose the unfinished gate.
export async function auditUnresolvedFitLocations(repository,{profile,policy}){
 const result=await repository.pool.query(`WITH latest AS(
 SELECT DISTINCT ON(a.job_id) a.job_id,a.decision,a.analysis_json FROM job_analysis a JOIN jobs j USING(job_id)
 WHERE a.analysis_json->>'profile_hash'=$1 AND a.analysis_json->>'policy_hash'=$2 AND a.analysis_json->>'job_content_hash'=j.content_hash
 ORDER BY a.job_id,a.created_at DESC,a.analysis_id DESC)
 UPDATE relevance_queue q SET status='OPEN_UNVERIFIED',error_code='FIT_LOCATION_EVIDENCE_REQUIRED',next_retry_at=now()+interval '6 hours',updated_at=now()
 FROM latest a WHERE q.job_id=a.job_id AND q.status='ANALYZED' AND a.decision<>'REJECT'
 AND (a.analysis_json->>'location_policy_status'='UNVERIFIED' OR a.analysis_json->>'fit_complete'='false')`,[hash(profile),hash(policy)]);
 return {location_pending:result.rowCount};
}
