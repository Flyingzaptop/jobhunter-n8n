// Explicit operator recovery only. This script never submits a form.
import {Repository} from '../services/core/repository.mjs';
import {BrowserClient} from '../services/core/application.mjs';
import {randomUUID} from 'node:crypto';
const applicationId=process.argv[2];
if(!/^[a-f0-9-]{36}$/.test(applicationId??'')||!process.argv.includes('--user-requested-new-review'))throw Error('EXPLICIT_USER_REPREPARATION_REQUIRED');
const repository=new Repository(),browser=new BrowserClient();
try{
 const app=(await repository.pool.query("SELECT a.*,j.application_url,j.canonical_url FROM applications a JOIN jobs j USING(job_id) WHERE application_id=$1",[applicationId])).rows[0];
 if(app?.status!=='SUBMISSION_UNKNOWN')throw Error('ONLY_UNKNOWN_ATTEMPT_REPREPARATION_SUPPORTED');
 const opened=await browser.call('/sessions',{application_id:applicationId,url:app.application_url??app.canonical_url});
 const client=await repository.pool.connect();try{
  await client.query('BEGIN');const current=(await client.query('SELECT status FROM applications WHERE application_id=$1 FOR UPDATE',[applicationId])).rows[0];if(current.status!=='SUBMISSION_UNKNOWN')throw Error('APPLICATION_STATE_CHANGED');
  await client.query("UPDATE confirmed_submit_commands SET superseded_at=now(),superseded_reason='USER_REQUESTED_NEW_REVIEW_AFTER_UNKNOWN' WHERE application_id=$1 AND superseded_at IS NULL AND status='SUBMISSION_UNKNOWN'",[applicationId]);
  await client.query("UPDATE application_review_gates SET status='REVOKED',revoked_at=now() WHERE application_id=$1 AND status IN ('APPROVED','PREPARED','CONSUMED')",[applicationId]);
  await client.query("UPDATE applications SET status='FILLING',last_state=last_state||$2::jsonb,updated_at=now() WHERE application_id=$1",[applicationId,{browser_session_id:opened.session_id,final_review:null,current_url:opened.snapshot.url,confirmed_submit_command_id:null}]);
  await client.query("INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json)VALUES($1,'application',$2,'USER_REQUESTED_REPREPARATION_AFTER_UNKNOWN',$3)",[randomUUID(),applicationId,{previous_session_id:app.last_state.browser_session_id,new_session_id:opened.session_id,previous_result_remains_unknown:true,new_confirmation_required:true,submit_performed:false}]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 console.log(JSON.stringify({application_id:applicationId,status:'FILLING',session_id:opened.session_id,new_confirmation_required:true,submitted:false}));
}finally{await repository.close();}
