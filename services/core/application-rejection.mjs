import {randomUUID} from 'node:crypto';import {hitlError} from './hitl.mjs';
export async function rejectPreparedApplication({repository,applicationId,profileId,reason,source,approvalId,bindingDigest}){
 if(!['USER_TELEGRAM','USER_CHAT','USER_DASHBOARD'].includes(source)||typeof reason!=='string'||!reason.trim()||reason.length>1000)throw hitlError('TELEGRAM_SUBMIT_INVALID_REJECTION');
 const client=await repository.pool.connect();try{await client.query('BEGIN');
  const app=(await client.query('SELECT * FROM applications WHERE application_id=$1 AND candidate_profile_id=$2 FOR UPDATE',[applicationId,profileId])).rows[0];
  if(!app)throw hitlError('TELEGRAM_SUBMIT_APPLICATION_NOT_FOUND');
  if(app.status==='SKIPPED'&&app.last_state?.user_rejection){await client.query('COMMIT');return {status:'SKIPPED',duplicate:true,application_id:applicationId};}
  if(!['READY_TO_SUBMIT','FILLING','NEEDS_USER'].includes(app.status)||app.submitted_at||app.confirmation_id)throw hitlError('TELEGRAM_SUBMIT_REJECTION_TOO_LATE');
  if(source==='USER_TELEGRAM'){
   const gate=(await client.query('SELECT * FROM application_review_gates WHERE approval_id=$1 AND application_id=$2 FOR UPDATE',[approvalId,applicationId])).rows[0];
   if(!gate||gate.candidate_profile_id!==profileId||gate.binding_digest!==bindingDigest||gate.status==='CONSUMED')throw hitlError('TELEGRAM_SUBMIT_REVIEW_STALE');
  }
  const rejection={reason:reason.trim(),source,rejected_at:new Date().toISOString(),approval_id:approvalId??null};
  await client.query("UPDATE application_review_gates SET status='REVOKED',revoked_at=now() WHERE application_id=$1 AND status IN('PREPARED','APPROVED')",[applicationId]);
  await client.query("UPDATE applications SET status='SKIPPED',skip_reason='USER_REJECTED',last_state=last_state||jsonb_build_object('user_rejection',$2::jsonb),updated_at=now() WHERE application_id=$1",[applicationId,rejection]);
  await client.query("UPDATE application_questions SET closed_at=now(),closed_reason='APPLICATION_REJECTED_BY_USER' WHERE application_id=$1 AND answered_at IS NULL AND closed_at IS NULL",[applicationId]);
  await client.query("INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json) VALUES($1,'application',$2,'USER_APPLICATION_REJECTED',$3)",[randomUUID(),applicationId,rejection]);
  await client.query('COMMIT');return {status:'SKIPPED',application_id:applicationId,reason:rejection.reason};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
