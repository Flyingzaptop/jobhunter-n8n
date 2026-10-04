import {readFile} from 'node:fs/promises';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {BrowserClient} from '../services/core/application.mjs';
import {verifyCurrentCvEvidence} from '../services/core/cv-evidence.mjs';
import {settleApplicationForm} from '../services/core/form-settling.mjs';
import {enqueueCaptchaHandoff,deliverCaptchaHandoff} from '../services/core/captcha-handoff.mjs';
import {Telegram} from '../services/core/telegram.mjs';
const applicationId=process.argv[2];
if(!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(applicationId??''))throw new Error('APPLICATION_ID_REQUIRED');
if(process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT==='true')throw new Error('CONTROLLED_PREPARATION_REQUIRED');
const repository=new Repository(),browser=new BrowserClient(),telegram=new Telegram();
try{
 await repository.migrate();
 const app=(await repository.pool.query('SELECT * FROM applications WHERE application_id=$1',[applicationId])).rows[0];
 if(!app||app.status!=='MANUAL_TAKEOVER'||app.last_state?.reason!=='INTERACTIVE_CAPTCHA'||app.confirmation_id||app.submitted_at)throw new Error('UNSUBMITTED_MANUAL_CAPTCHA_REQUIRED');
 const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));
 if(app.candidate_profile_id!==profile.profile_id)throw new Error('PROFILE_MISMATCH');
 const job=(await repository.listCanonicalJobs()).find(j=>j.job_id===app.job_id);
 const cv=(await repository.pool.query('SELECT * FROM cv_versions WHERE cv_id=$1',[app.cv_id])).rows[0];
 const analysis=(await repository.pool.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[app.job_id])).rows[0]?.analysis_json;
 if(!(await verifyCurrentCvEvidence({cv,job,profile,analysis})).pass)throw new Error('CURRENT_CV_EVIDENCE_REQUIRED');
 if(app.last_state.browser_session_id){
  const history=await browser.call(`/sessions/${app.last_state.browser_session_id}/snapshot`).catch(()=>null);
  if(history?.action_history?.some(x=>['submit_intent','submit'].includes(x.operation)))throw new Error('SUBMIT_HISTORY_PREVENTS_REOPEN');
 }
 const opened=await browser.call('/sessions',{application_id:applicationId,url:job.application_url});
 const view=await settleApplicationForm({browser,sessionId:opened.session_id,initialView:opened.snapshot});
 if(!view.captcha)throw new Error('FRESH_CAPTCHA_NOT_OBSERVED');
 await repository.pool.query("UPDATE applications SET last_state=last_state||$2::jsonb,updated_at=now() WHERE application_id=$1 AND status='MANUAL_TAKEOVER'",[applicationId,{browser_session_id:opened.session_id,current_url:view.url,page_fingerprint:view.fingerprint,pending_question:null}]);
 await repository.event('application',applicationId,'MANUAL_CAPTCHA_SESSION_REOPENED',{browser_session_id:opened.session_id,reason:'USER_REQUESTED_TELEGRAM_HANDOFF_TEST',submission_enabled:false});
 const handoff=await enqueueCaptchaHandoff({repository,applicationId,sessionId:opened.session_id,snapshot:view,chatId:telegram.chatId});
 const result=await deliverCaptchaHandoff({repository,handoffId:handoff.handoff_id,browser,telegram});
 console.log(JSON.stringify({application_id:applicationId,...result,real_employer_submissions:0}));
}finally{await repository.close();}
