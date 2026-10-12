// One bounded, user-authorized application. No discovery, workers or scheduler.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {BrowserClient,runApplication} from '../services/core/application.mjs';
import {browserConfig} from '../services/browser-service/server.mjs';
import {Telegram} from '../services/core/telegram.mjs';
import {autonomousAuthorization,assertAutonomousTarget} from '../services/core/autonomous-authorization.mjs';
import {resumeVerifiedHumanCaptcha} from '../services/core/manual-captcha-resume.mjs';
import {enqueueFormModelReview,drainFormModelReviews} from '../services/core/form-model-review.mjs';
import {OllamaClient} from '../services/core/llm.mjs';
import {submitAutonomousApplication} from '../services/core/autonomous-submit.mjs';
const applicationId=process.argv[2];
if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(applicationId??''))throw Error('APPLICATION_ID_REQUIRED');
const repo=new Repository(undefined,{max:2}),browser=new BrowserClient(),telegram=new Telegram();
const profile=YAML.parse(await fs.readFile('config/candidate_profile.yaml','utf8'));
const policy=YAML.parse(await fs.readFile('config/search_policy.yaml','utf8'));
const logFile=`data/acceptance/${applicationId}-continuation.json`;
const lms=process.env.LMS_CLI_PATH??path.join(os.homedir(),'.lmstudio','bin','lms.exe');
const cli=args=>new Promise((resolve,reject)=>{const child=spawn(lms,args,{windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('LOCAL_MODEL_COMMAND_FAILED')));});
let loaded=false,sessionId,completed=false;
try{
 const grant=await autonomousAuthorization(profile);
 if(grant.mode!=='CONTROLLED_VALIDATION'||grant.allowed_application_ids?.length!==1)throw Error('EXACTLY_ONE_VALIDATION_TARGET_REQUIRED');
 assertAutonomousTarget(grant,applicationId);
 const deadline=Date.now()+30*60*1000;
 while(Date.now()<deadline){
  if((await repo.pool.query('SELECT paused FROM runtime_control WHERE id=true')).rows[0]?.paused)throw Error('PAUSED_BY_USER');
  const app=(await repo.pool.query('SELECT * FROM applications WHERE application_id=$1',[applicationId])).rows[0];
  if(!app||app.candidate_profile_id!==profile.profile_id)throw Error('APPLICATION_PROFILE_MISMATCH');
  sessionId=app.last_state.browser_session_id;
  if(app.status==='MANUAL_TAKEOVER'&&app.last_state.reason==='INTERACTIVE_CAPTCHA'){
   await browser.call(`/sessions/${sessionId}/lease`,{});
   const completion=await browser.call(`/sessions/${sessionId}/human-captcha-completion`,{});
   if(completion.verified===true){
    try{await resumeVerifiedHumanCaptcha({repository:repo,browser,applicationId,profileId:profile.profile_id,source:'USER_DASHBOARD'});}
    catch(error){const current=(await repo.pool.query('SELECT status,last_state FROM applications WHERE application_id=$1',[applicationId])).rows[0];if(current?.status!=='FILLING'||current.last_state?.reason!=='HUMAN_CAPTCHA_VERIFIED'||current.last_state.browser_session_id!==sessionId)throw error;}
   }
   else{await new Promise(resolve=>setTimeout(resolve,3000));continue;}
  }else if(app.status!=='FILLING')throw Error('UNEXPECTED_APPLICATION_STATE_'+app.status);
  // Recheck the same filled form; unknown outcomes never enter this branch.
  const filled=await runApplication({repository:repo,applicationId,jobId:app.job_id,profile,policy,browser,telegram,config:{...browserConfig(),dryRun:true,allowRealSubmit:false,fillAllFields:true}});
  if(filled.status!=='READY_TO_SUBMIT')throw Error('FORM_CONTINUATION_NOT_READY_'+filled.status);
  await new Promise(resolve=>setTimeout(resolve,4000));
  const review=await enqueueFormModelReview({repository:repo,applicationId,profile,browser});
  if(review.status!=='APPROVED'){
   await browser.call(`/sessions/${sessionId}/lease`,{});
   await cli(['load','gemma4-26b-a4b-qat-uncensored-hauhaucs-balanced-mtp','--identifier','jobhunter-gemma4','--context-length','16384','--gpu','0.25','--parallel','1','--ttl','600','--yes']);loaded=true;
   const checked=await drainFormModelReviews({repository:repo,applicationId,profile,policy,llm:new OllamaClient(),browser});
   if(checked.verdict!=='+')throw Error('WHOLE_FORM_REVIEW_NOT_APPROVED');
  }
  const result=await submitAutonomousApplication({repository:repo,applicationId,profile,browser});
  await fs.writeFile(logFile,JSON.stringify(result,null,2),{mode:0o600});
  if(result.status!=='SUBMITTED')throw Error('SITE_CONFIRMATION_NOT_OBSERVED_'+result.status);
  const form=new FormData();form.set('chat_id',telegram.chatId);form.set('caption','✅ Заявка AI Technician отправлена. Сайт подтвердил получение. Только одна заявка; массовая рассылка выключена.');form.set('photo',new Blob([await fs.readFile(result.screenshot_path)],{type:'image/png'}),'site-confirmation.png');
  const delivered=await(await telegram.fetch(`https://api.telegram.org/bot${telegram.token}/sendPhoto`,{method:'POST',body:form,signal:AbortSignal.timeout(15000)})).json();
  if(!delivered.ok)throw Error('SITE_CONFIRMED_TELEGRAM_SCREENSHOT_DELIVERY_FAILED');
  completed=true;break;
 }
 if(!completed)throw Error('MANUAL_CAPTCHA_LINK_EXPIRED');
}catch(error){
 await fs.writeFile(logFile,JSON.stringify({application_id:applicationId,error:error.message,at:new Date().toISOString()}),{mode:0o600});
 await telegram.send(`Одна проверочная заявка: ${error.message}. Повторный Submit автоматически не выполняется; массовая рассылка выключена.`).catch(()=>{});
}finally{
 if(loaded)await cli(['unload','jobhunter-gemma4']).catch(()=>{});
 await repo.pool.query('UPDATE runtime_control SET paused=true WHERE id=true');
 if(sessionId)await browser.call(`/sessions/${sessionId}/lease`,{release:true}).catch(()=>{});
 await repo.close();
}
