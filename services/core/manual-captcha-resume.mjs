import {randomUUID} from 'node:crypto';
export async function resumeVerifiedHumanCaptcha({repository,browser,applicationId,profileId,source='USER_DASHBOARD',expectedHandoffId}){
 if(!['USER_DASHBOARD','USER_TELEGRAM'].includes(source))throw new Error('INVALID_HUMAN_CAPTCHA_SOURCE');
 const client=await repository.pool.connect();
 try{
  await client.query('BEGIN');
  const app=(await client.query('SELECT * FROM applications WHERE application_id=$1 FOR UPDATE',[applicationId])).rows[0];
  if(!app||app.candidate_profile_id!==profileId||app.status!=='MANUAL_TAKEOVER'||app.last_state?.reason!=='INTERACTIVE_CAPTCHA'||app.dry_run!==true||app.confirmation_id||app.submitted_at)throw new Error('MANUAL_CAPTCHA_APPLICATION_NOT_ELIGIBLE');
  const handoff=app.last_state.captcha_handoff;
  const record=(await client.query('SELECT * FROM captcha_handoffs WHERE handoff_id=$1 AND application_id=$2 FOR UPDATE',[handoff?.handoff_id,applicationId])).rows[0];
  const sessionId=app.last_state.browser_session_id;
  if(!record||record.resolved_at||record.browser_session_id!==sessionId||(expectedHandoffId&&record.handoff_id!==expectedHandoffId))throw new Error('CURRENT_UNRESOLVED_CAPTCHA_HANDOFF_REQUIRED');
  const completion=await browser.call(`/sessions/${sessionId}/human-captcha-completion`,{});
  const view=await browser.call(`/sessions/${sessionId}/snapshot`);
  if(completion.verified!==true||view.browser_session_id!==sessionId||view.captcha!==false)throw new Error('FRESH_HUMAN_CAPTCHA_COMPLETION_REQUIRED');
  const command=(await client.query('SELECT * FROM confirmed_submit_commands WHERE application_id=$1 AND superseded_at IS NULL FOR UPDATE',[applicationId])).rows[0];
  if(command){
   if(command.status!=='BLOCKED'||command.result_json?.reason!=='INTERACTIVE_CAPTCHA'||command.result_json?.transport_evidence?.state!=='NOT_DISPATCHED'||command.result_json?.transport_evidence?.browser_session_id!==sessionId||view.submit_transport?.state!=='NOT_DISPATCHED')throw new Error('UNCERTAIN_TRANSPORT_PREVENTS_CAPTCHA_RETRY');
   await client.query("UPDATE confirmed_submit_commands SET superseded_at=now(),superseded_reason='HUMAN_CAPTCHA_VERIFIED_ZERO_DISPATCH',updated_at=now() WHERE command_id=$1",[command.command_id]);
  }
  await client.query("UPDATE applications SET status='FILLING',last_state=last_state||$2::jsonb,updated_at=now() WHERE application_id=$1",[applicationId,{reason:'HUMAN_CAPTCHA_VERIFIED',pending_question:null,page_fingerprint:view.fingerprint,current_url:view.url,captcha_handoff:{...handoff,resolved_at:completion.observed_at,resolution_source:source,human_interaction_required:false}}]);
  await client.query("UPDATE captcha_handoffs SET resolved_at=now(),resolution_source=$4,resolved_snapshot_fingerprint=$2,resolved_browser_session_id=$3 WHERE handoff_id=$1",[record.handoff_id,view.fingerprint,sessionId,source]);
  await client.query('UPDATE captcha_access_grants SET revoked_at=now() WHERE handoff_id=$1 AND revoked_at IS NULL',[record.handoff_id]);
  // A manual CAPTCHA resolution is an audit event, not a factual answer receipt.
  await client.query('UPDATE application_questions SET answered_at=now() WHERE question_id=$1',[record.question_id]);
  const retry=await client.query("UPDATE continuous_work SET status='RETRY',next_retry_at=now(),lease_until=NULL,updated_at=now(),outcome_code='HUMAN_CAPTCHA_VERIFIED' WHERE lane='preparation' AND entity_id=$1 AND status='WAITING_USER'",[app.job_id]);
  await client.query('INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json)VALUES($1,$2,$3,$4,$5)',[randomUUID(),'application',applicationId,'HUMAN_CAPTCHA_VERIFIED',{source,browser_session_id:sessionId,handoff_id:record.handoff_id,form_fingerprint:view.fingerprint,queue_rows_released:retry.rowCount,submission_enabled:false}]);
  await client.query('COMMIT');return {application_id:applicationId,status:'FILLING',same_browser_session:true,queue_rows_released:retry.rowCount,submission_enabled:false};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
