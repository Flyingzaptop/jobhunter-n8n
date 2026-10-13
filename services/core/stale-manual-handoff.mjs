export async function retireSupersededManualHandoffs(repository,applicationId,currentSessionId){
 const client=await repository.pool.connect();
 try{
  await client.query('BEGIN');
  const app=(await client.query('SELECT status,last_state,submitted_at,confirmation_id FROM applications WHERE application_id=$1 FOR UPDATE',[applicationId])).rows[0];
  if(!app||!['FILLING','READY_TO_SUBMIT'].includes(app.status)||app.submitted_at||app.confirmation_id||app.last_state?.browser_session_id!==currentSessionId){await client.query('ROLLBACK');return 0;}
  const pendingCommand=(await client.query('SELECT 1 FROM confirmed_submit_commands WHERE application_id=$1 AND superseded_at IS NULL',[applicationId])).rowCount;
  if(pendingCommand){await client.query('ROLLBACK');return 0;}
  const rows=(await client.query("UPDATE captcha_handoffs SET resolved_at=now(),resolution_source='SYSTEM_SESSION_SUPERSEDED',resolved_browser_session_id=$2 WHERE application_id=$1 AND browser_session_id<>$2 AND resolved_at IS NULL RETURNING handoff_id,question_id",[applicationId,currentSessionId])).rows;
  for(const row of rows){
   await client.query("UPDATE application_questions SET closed_at=now(),closed_reason='SUPERSEDED_BROWSER_SESSION' WHERE question_id=$1 AND answered_at IS NULL AND closed_at IS NULL",[row.question_id]);
   await client.query('UPDATE captcha_access_grants SET revoked_at=now() WHERE handoff_id=$1 AND revoked_at IS NULL',[row.handoff_id]);
  }
  await client.query('COMMIT');
  return rows.length;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
