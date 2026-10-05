import {randomUUID} from 'node:crypto';
import {consumeApplicationReview,digest,formBinding} from '../dashboard/review-gates.mjs';
import {issueSubmitCapability} from '../browser-service/submit-capability.mjs';
import {assertControlledApplicationReady} from './controlled-submit-gate.mjs';
import {transition} from './state.mjs';
import {hitlError} from './hitl.mjs';
import {confirmedSubmissionResult} from './submission-result.mjs';
import {finalSubmitLabel} from '../browser-service/ats-adapters.mjs';
export async function executeConfirmedSubmit({repository,applicationId,approvalId,bindingDigest,idempotencyKey,profile,browser,confirmationSource='USER_DASHBOARD',secret=process.env.BROWSER_SERVICE_TOKEN}){
 if(!['USER_DASHBOARD','USER_TELEGRAM'].includes(confirmationSource))throw hitlError('INVALID_CONFIRMATION_SOURCE');
 for(const id of [applicationId,approvalId,idempotencyKey])if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id??''))throw hitlError('INVALID_SUBMIT_COMMAND',400);
 if(!/^[a-f0-9]{64}$/i.test(bindingDigest??''))throw hitlError('INVALID_SUBMIT_BINDING',400);
 const client=await repository.pool.connect();let locked=false,command;
 try{
  locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[applicationId])).rows[0].locked;
  if(!locked)throw hitlError('APPLICATION_BUSY');
  const app=(await repository.pool.query('SELECT * FROM applications WHERE application_id=$1 AND candidate_profile_id=$2',[applicationId,profile.profile_id])).rows[0];
  if(!app)throw hitlError('APPLICATION_NOT_FOR_ACTIVE_PROFILE',404);
  const previous=(await repository.pool.query('SELECT * FROM confirmed_submit_commands WHERE application_id=$1',[applicationId])).rows[0];
  if(previous){if(previous.idempotency_key!==idempotencyKey||previous.approval_id!==approvalId||previous.binding_digest!==bindingDigest)throw hitlError('APPLICATION_ALREADY_HAS_SUBMIT_COMMAND');return {command_id:previous.command_id,status:previous.status,confirmation_id:previous.result_json?.confirmation_id??null,duplicate:true};}
  const paused=(await repository.pool.query('SELECT paused FROM runtime_control WHERE id=true')).rows[0]?.paused;
  if(paused)throw hitlError('PAUSED');
  await assertControlledApplicationReady({repository,applicationId,profile});
  const review=(await repository.pool.query('SELECT * FROM application_review_gates WHERE approval_id=$1 AND application_id=$2 AND binding_digest=$3',[approvalId,applicationId,bindingDigest])).rows[0];
  if(!review||review.status!=='APPROVED'||review.candidate_profile_id!==profile.profile_id)throw hitlError('DASHBOARD_APPROVAL_REQUIRED');
  // Reserve durably before consuming the approval. A crash must leave an
  // identifiable command rather than a consumed approval with no intent record.
  command=(await repository.pool.query("INSERT INTO confirmed_submit_commands(command_id,application_id,approval_id,idempotency_key,binding_digest,status)VALUES($1,$2,$3,$4,$5,'PREPARING')RETURNING *",[randomUUID(),applicationId,approvalId,idempotencyKey,bindingDigest])).rows[0];
  await consumeApplicationReview(repository,applicationId,approvalId,profile,browser,{assertProductionGate:async()=>true});
  const sessionId=app.last_state.browser_session_id,snapshot=await browser.call(`/sessions/${sessionId}/snapshot`);
  if(digest(formBinding(snapshot))!==review.digests?.form)throw hitlError('APPROVED_FORM_CHANGED_BEFORE_SUBMIT');
  const button=snapshot.buttons.find(b=>b.visible!==false&&!b.disabled&&(b.final_submit||finalSubmitLabel(b.text)));
  if(!button||snapshot.captcha||snapshot.validation_errors?.length)throw hitlError('FORM_NOT_READY');
  const capability=issueSubmitCapability({secret,approvalId,applicationId,snapshot,source:confirmationSource});
  await transition(repository,applicationId,'SUBMITTING',{confirmed_submit_command_id:command.command_id});
  await repository.pool.query("UPDATE confirmed_submit_commands SET status='SUBMITTING',updated_at=now() WHERE command_id=$1",[command.command_id]);
  const result=await browser.call(`/sessions/${sessionId}/submit`,{selector:button.selector,confirmation_capability:capability});
  const evidence=confirmedSubmissionResult(result),status=evidence.status;
  await transition(repository,applicationId,status,evidence);
  if(status==='SUBMITTED')await repository.pool.query('UPDATE applications SET confirmation_id=$2,submitted_at=now() WHERE application_id=$1',[applicationId,evidence.confirmation_id]);
  await repository.pool.query('UPDATE confirmed_submit_commands SET status=$2,result_json=$3,updated_at=now() WHERE command_id=$1',[command.command_id,status,evidence]);
  return {command_id:command.command_id,...evidence};
 }catch(error){
  if(command){await repository.pool.query("UPDATE confirmed_submit_commands SET status=CASE WHEN status='SUBMITTING' THEN 'SUBMISSION_UNKNOWN' ELSE 'BLOCKED' END,result_json=$2,updated_at=now() WHERE command_id=$1",[command.command_id,{error_code:/^[A-Z_]+$/.test(error.code??error.message)?error.code??error.message:'SUBMIT_COMMAND_FAILED'}]);
   const current=(await repository.pool.query('SELECT status FROM applications WHERE application_id=$1',[applicationId])).rows[0];if(current?.status==='SUBMITTING')await transition(repository,applicationId,'SUBMISSION_UNKNOWN',{reason:'SUBMIT_COMMAND_INTERRUPTED'});}
  throw error;
 }finally{try{if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[applicationId]);}finally{client.release();}}
}
