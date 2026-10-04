import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {verifyCurrentCvEvidence} from './cv-evidence.mjs';
import {reverifyMarketJob} from './discovery-v2.mjs';
import {settleApplicationForm} from './form-settling.mjs';
const untouched=s=>!s.submit_attempted&&!s.submission_confirmation&&!s.uploaded_file_hashes?.length&&!Object.keys(s.filled_fields??{}).length&&!(s.fields??[]).some(f=>f.visible&&['text','email','tel','textarea','file'].includes(f.type)&&String(f.value??'').trim())&&(s.action_history??[]).every(h=>['navigate','checkpoint','screenshot'].includes(h.operation));
export function preloadedCaptchaRecoveryEvidence(view){
 const observation=view.captcha_observation;
 return {pass:untouched(view)&&view.captcha===false&&observation?.pending===false&&Boolean(observation.frames?.some(f=>f.provider==='recaptcha'&&f.size==='invisible'&&f.path.endsWith('/anchor')&&!f.pending&&!f.checkbox_visible)),human_captcha_solved:false};
}
export async function recoverPreloadedCaptcha({repository,browser,applicationId,profile,config}){
 if(!config.dryRun||config.allowRealSubmit)throw new Error('RECOVERY_REQUIRES_DRY_RUN');
 const client=await repository.pool.connect();
 try{
  await client.query('BEGIN');
  const app=(await client.query('SELECT * FROM applications WHERE application_id=$1 FOR UPDATE',[applicationId])).rows[0];
  if(!app||app.status!=='MANUAL_TAKEOVER'||app.last_state?.reason!=='INTERACTIVE_CAPTCHA'||app.candidate_profile_id!==profile.profile_id||app.last_state.preparation_only!==true||!app.dry_run||app.confirmation_id||app.submitted_at)throw new Error('UNTOUCHED_PREPARATION_CAPTCHA_HOLD_REQUIRED');
  const cv=(await client.query('SELECT * FROM cv_versions WHERE cv_id=$1',[app.cv_id])).rows[0],analysis=(await client.query('SELECT analysis_json,decision FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[app.job_id])).rows[0];
  if(!['REVIEW','STRETCH','AUTO_APPLY'].includes(analysis?.decision)||analysis.analysis_json?.hard_blockers?.length)throw new Error('NON_BLOCKED_CURRENT_ANALYSIS_REQUIRED');
  const job=(await repository.listCanonicalJobs()).find(j=>j.job_id===app.job_id),verified=await reverifyMarketJob({job,repository});
  if(verified.status!=='OPEN')throw new Error('CURRENT_OFFICIAL_POSTING_NOT_OPEN');
  const evidence=await verifyCurrentCvEvidence({cv,job:verified.job??job,profile,analysis:analysis.analysis_json,artifactRoot:config.artifactRoot});if(!evidence.pass)throw new Error('CURRENT_VERIFIED_CV_EVIDENCE_REQUIRED');
  let sessionId=app.last_state.browser_session_id,view;
  try{view=await browser.call(`/sessions/${sessionId}/snapshot`);if(!untouched(view))throw new Error('PRIOR_APPLICATION_ACTION_PREVENTS_BUG_RECOVERY');}
  catch(error){if(error.message!=='SESSION_NOT_FOUND')throw error;if(!/^[a-f0-9-]{36}$/i.test(sessionId??''))throw new Error('INVALID_SAVED_SESSION');const saved=JSON.parse(await readFile(path.join(config.stateRoot,sessionId+'.json'),'utf8'));if(!untouched(saved))throw new Error('PRIOR_APPLICATION_ACTION_PREVENTS_REOPEN');const opened=await browser.call('/sessions',{application_id:applicationId,url:job.application_url});sessionId=opened.session_id;view=opened.snapshot;}
  view=await settleApplicationForm({browser,sessionId,initialView:view});
  // Form fields can settle before the provider's invisible anchor is inserted.
  // Wait for the precise benign-widget evidence; absence alone never releases a hold.
  const observationDeadline=Date.now()+8000;
  while(!preloadedCaptchaRecoveryEvidence(view).pass&&Date.now()<observationDeadline){
    if(!untouched(view)||view.captcha)break;
    await new Promise(resolve=>setTimeout(resolve,250));
    view=await browser.call(`/sessions/${sessionId}/snapshot`);
  }
  const observation=view.captcha_observation;
  if(!preloadedCaptchaRecoveryEvidence(view).pass)throw new Error('PRELOADED_INVISIBLE_WIDGET_NOT_FRESHLY_OBSERVED');
  const handoff=app.last_state.captcha_handoff;
  if(handoff?.handoff_id){await client.query("UPDATE captcha_handoffs SET resolved_at=now(),resolution_source='SYSTEM_BUG_RECOVERY',resolved_snapshot_fingerprint=$2,resolved_browser_session_id=$3 WHERE handoff_id=$1 AND application_id=$4 AND resolved_at IS NULL",[handoff.handoff_id,view.fingerprint,sessionId,applicationId]);await client.query('UPDATE application_questions SET answered_at=now() WHERE question_id IN (SELECT question_id FROM captcha_handoffs WHERE handoff_id=$1)',[handoff.handoff_id]);await client.query('UPDATE captcha_access_grants SET revoked_at=now() WHERE handoff_id=$1 AND revoked_at IS NULL',[handoff.handoff_id]);}
  await client.query("UPDATE applications SET status='FILLING',last_state=last_state||$2::jsonb,updated_at=now() WHERE application_id=$1",[applicationId,{reason:'CORRECTED_PRELOADED_WIDGET',pending_question:null,browser_session_id:sessionId,current_url:view.url,page_fingerprint:view.fingerprint,captcha_handoff:{...handoff,human_interaction_required:false,resolution_source:'SYSTEM_BUG_RECOVERY'}}]);
  await client.query("UPDATE continuous_work SET status='RETRY',next_retry_at=now(),lease_until=NULL,updated_at=now(),outcome_code='CORRECTED_PRELOADED_WIDGET' WHERE lane='preparation' AND entity_id=$1 AND status='WAITING_USER'",[app.job_id]);
  await client.query('INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json)VALUES($1,$2,$3,$4,$5)',[randomUUID(),'application',applicationId,'CAPTCHA_FALSE_POSITIVE_CORRECTED',{reason:'CORRECTED_PRELOADED_WIDGET',source:'SYSTEM_BUG_RECOVERY',browser_session_id:sessionId,observed_frames:observation.frames,human_captcha_solved:false,current_cv_evidence_pass:true,submit_enabled:false}]);
  await client.query('COMMIT');return {application_id:applicationId,status:'FILLING',reason:'CORRECTED_PRELOADED_WIDGET',browser_session_id:sessionId,human_captcha_solved:false,submission_enabled:false};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
