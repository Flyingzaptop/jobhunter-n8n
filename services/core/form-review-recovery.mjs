export async function wakePreparation(repository,jobId){
 await repository.pool.query("UPDATE continuous_work SET status='RETRY',next_retry_at=now(),outcome_code='FORM_CORRECTION_REQUIRED' WHERE lane='preparation' AND entity_id=$1 AND status IN('COMPLETED','WAITING_USER','RETRY')",[jobId]);
}
export function reviewFailureState({applicationStatus,previous={},binding,error,now=Date.now()}){
 const attempts=(previous.error_attempts??0)+1;
 return {status:applicationStatus==='FILLING'?'CORRECTION_PENDING':attempts>=3?'BLOCKED':'PENDING',
  binding_hash:binding,error:String(error.message??error.code??error).slice(0,240),error_attempts:attempts,
  next_retry_at:new Date(now+Math.min(1800000,30000*2**Math.min(attempts-1,6))).toISOString(),
  changes:previous.changes??[],at:new Date(now).toISOString()};
}
