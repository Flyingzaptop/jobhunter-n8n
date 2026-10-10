// Called by the independent worker, not a scheduled task. Only unsubmitted
// drafts with explicitly recoverable failures are restarted.
export async function recoverStrandedApplications(repository){
 const client=await repository.pool.connect();try{
  await client.query('BEGIN');
  const recovered=(await client.query(`UPDATE applications a SET status='OPENING',updated_at=now(),
   last_state=(last_state-'browser_session_id')||jsonb_build_object('recovery_restarts',coalesce((last_state->>'recovery_restarts')::int,0)+1,'pending_question',NULL,'full_fields_checked',false,'model_review',NULL)
   WHERE status='FAILED' AND submitted_at IS NULL AND confirmation_id IS NULL
   AND coalesce((last_state->>'recovery_restarts')::int,0)<3
   AND last_state->>'failure_reason' ~* 'Execution context was destroyed|locator.*Timeout|COMBOBOX_CHOICE_NOT_CONFIRMED|BROWSER_CAPACITY_RETRY'
   AND NOT EXISTS(SELECT 1 FROM confirmed_submit_commands c WHERE c.application_id=a.application_id)
   RETURNING application_id,job_id`)).rows;
  for(const row of recovered){await client.query("UPDATE continuous_work SET status='RETRY',next_retry_at=now() WHERE lane='preparation' AND entity_id=$1 AND status<>'RUNNING'",[row.job_id]);
   await client.query("INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json)VALUES(gen_random_uuid(),'application',$1,'UNSUBMITTED_DRAFT_RECOVERED','{}')",[row.application_id]);}
  await client.query(`UPDATE continuous_work w SET status='RETRY',next_retry_at=now() FROM applications a WHERE w.lane='preparation' AND w.entity_id=a.job_id AND w.status IN('WAITING_USER','COMPLETED') AND a.status='FILLING' AND a.last_state->'model_review'->>'status' IN('PENDING','CORRECTION_PENDING','REJECTED')`);
  await client.query('COMMIT');return {recovered:recovered.length};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
