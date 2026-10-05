import {Repository} from '../services/core/repository.mjs';
import {BrowserClient,reverify,runApplication} from '../services/core/application.mjs';
import {verifyCurrentCvEvidence} from '../services/core/cv-evidence.mjs';
import {Telegram} from '../services/core/telegram.mjs';
import {selectedCookieButton} from '../services/core/form-settling.mjs';
import {readFile} from 'node:fs/promises';import YAML from 'yaml';import {randomUUID} from 'node:crypto';
const applicationId=process.argv[2];
if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(applicationId??''))throw new Error('APPLICATION_UUID_REQUIRED');
if(process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT!=='false')throw new Error('CONTROLLED_DRY_RUN_REQUIRED');
const repository=new Repository(),browser=new BrowserClient();
try{
 const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8')),policy=YAML.parse(await readFile('config/search_policy.yaml','utf8'));
 const app=(await repository.pool.query('SELECT * FROM applications WHERE application_id=$1 AND candidate_profile_id=$2',[applicationId,profile.profile_id])).rows[0];
 const falseClosure=app?.status==='SKIPPED'&&app.skip_reason==='JOB_CLOSED_OR_UNVERIFIED';
 const correctedCookiePolicy=app?.status==='FAILED'&&app.last_state?.failure_reason==='UNCLASSIFIED_CLICK_NEEDS_USER'&&app.last_state?.repair_reason==='POLISH_COOKIE_OVERLAY_FIXED';
 let observedCookie=false;
 if(app?.status==='FAILED'&&String(app.last_state?.failure_reason).startsWith('locator.click: Timeout')&&app.last_state?.browser_session_id){
  let view;
  try{view=await browser.call(`/sessions/${app.last_state.browser_session_id}/snapshot`);}
  catch(error){
   if(error.message!=='SESSION_NOT_FOUND')throw error;
   const recovery=await browser.call(`/sessions/${app.last_state.browser_session_id}/recover`,{});
   if(recovery.status!=='FILLING')throw new Error('MANUAL_SESSION_RECOVERY_REQUIRED');
   await new Promise(resolve=>setTimeout(resolve,3000));
   view=await browser.call(`/sessions/${recovery.session_id}/snapshot`);
   await browser.call(`/sessions/${recovery.session_id}`,undefined,'DELETE');
  }
  observedCookie=!!selectedCookieButton(view)||new URL(view.url).hostname==='www.praca.pl'&&view.text.includes('Dostosuj zgody');
 }
 const cookieFailure=correctedCookiePolicy||observedCookie;
 if(!app||!falseClosure&&!cookieFailure||!app.dry_run||app.submitted_at||app.confirmation_id)throw new Error('DRAFT_NOT_ELIGIBLE_FOR_REPAIR');
 const repairReason=cookieFailure?'POLISH_COOKIE_OVERLAY_FIXED':'POLISH_OPEN_CHECK_FIXED';
 const row=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[app.job_id])).rows[0],job={...row.metadata,...row};
 const cv=(await repository.pool.query('SELECT * FROM cv_versions WHERE cv_id=$1',[app.cv_id])).rows[0];
 const analysis=(await repository.pool.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[app.job_id])).rows[0]?.analysis_json;
 if(!(await verifyCurrentCvEvidence({cv,job,analysis,profile})).pass)throw new Error('CURRENT_CV_EVIDENCE_REQUIRED');
 if(await reverify({browser,job,applicationId})!==true)throw new Error('LIVE_OPEN_VERIFICATION_REQUIRED');
 const client=await repository.pool.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[applicationId]);
  const changed=await client.query("UPDATE applications SET status='OPENING',skip_reason=NULL,last_state=last_state||$2::jsonb,updated_at=now() WHERE application_id=$1 AND status=$3 AND skip_reason IS NOT DISTINCT FROM $4 AND dry_run=true AND submitted_at IS NULL AND confirmation_id IS NULL",[applicationId,{repair_reason:repairReason,browser_session_id:null},app.status,app.skip_reason]);
  if(changed.rowCount!==1)throw new Error('DRAFT_CHANGED_DURING_REPAIR');
  await client.query('INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json)VALUES($1,$2,$3,$4,$5)',[randomUUID(),'application',applicationId,'UNVERIFIED_DRAFT_RESTORED',{reason:repairReason,real_submit:false}]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 const result=await runApplication({repository,jobId:app.job_id,applicationId,profile,policy,browser,telegram:new Telegram()});
 console.log(JSON.stringify({application_id:applicationId,status:result.status,reason:result.reason??null,submit_blocked_reason:result.submit_blocked_reason??null}));
}finally{await repository.close();}
