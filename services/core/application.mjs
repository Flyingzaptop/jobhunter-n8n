import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { transition } from './state.mjs';
import { browserConfig } from '../browser-service/server.mjs';
import { submitPermission, classifyConsent } from '../browser-service/policy.mjs';

export class BrowserClient {
  constructor({ baseUrl = process.env.BROWSER_SERVICE_URL || 'http://127.0.0.1:3001', token = process.env.BROWSER_SERVICE_TOKEN, fetchImpl = fetch } = {}) { this.baseUrl=baseUrl; this.token=token; this.fetch=fetchImpl; }
  async call(endpoint, body, method = body ? 'POST' : 'GET') { if (!this.token) throw new Error('BROWSER_TOKEN_REQUIRED'); const response=await this.fetch(this.baseUrl+endpoint,{method,headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)}); const result=await response.json();if(!response.ok)throw new Error(result.error||'BROWSER_ACTION_FAILED');return result; }
}
const known = value => value !== undefined && value !== null && value !== '' && value !== 'UNKNOWN';
const norm = value => String(value??'').toLowerCase().replace(/[_\W]+/g,' ').trim();
const country = value => /^(pl|poland)$/i.test(value) ? 'PL' : String(value||'').toUpperCase();

export function professionalYears(profile) {
  if(known(profile.candidate?.professional_years))return profile.candidate.professional_years;
  if((profile.experience||[]).some(f=>f.provenance==='PROFESSIONAL'&&(!f.exact_start_date||!f.exact_end_date)))return undefined;
  const intervals=(profile.experience||[]).filter(f=>f.provenance==='PROFESSIONAL' && f.exact_start_date && f.exact_end_date).map(f=>[Date.parse(f.exact_start_date),Date.parse(f.exact_end_date)+86400000]).filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>=a).sort((a,b)=>a[0]-b[0]);
  if (!intervals.length) return undefined;
  const merged=[];for(const interval of intervals){const last=merged.at(-1);if(last&&interval[0]<=last[1])last[1]=Math.max(last[1],interval[1]);else merged.push([...interval]);}
  return Math.floor(merged.reduce((n,[a,b])=>n+b-a,0)/86400000/365.25+0.01);
}

export function resolveField(field, { profile, job, answerMemory = {} }) {
  const identity=profile.onboarding||{}, candidate=profile.candidate||{}, key=norm(field.name), label=norm(field.label), legal=identity.legal_name||candidate.legal_name||candidate.name;
  const skills=Object.values(profile.skills||{}).flat().map(norm), facts=[...(profile.experience||[]),...(profile.projects||[]),...(profile.education||[])];
  let value, source='PROFILE';
  const nameParts=known(legal)?String(legal).trim().split(/\s+/):[];
  const direct={first_name:identity.first_name||(nameParts.length===2?nameParts[0]:undefined),last_name:identity.last_name||(nameParts.length===2?nameParts[1]:undefined),email:identity.email,phone:identity.phone,city:candidate.base_location?.city,country:candidate.base_location?.country,portfolio_url:identity.portfolio_url||identity.github_url,current_title:(profile.experience||[]).find(f=>f.provenance==='PROFESSIONAL')?.role,years_experience:professionalYears(profile),education:(profile.education||[]).filter(f=>f.provenance==='EDUCATION').map(f=>[f.degree,f.field,f.institution].filter(known).join(', ')).join('; '),start_date:identity.earliest_start_date,employment_type:candidate.availability?.full_time===true?'Full-time':undefined,authorized_poland:candidate.eu_citizen===true?'Yes':undefined,eu_authorized:candidate.eu_citizen===true?'yes':undefined};
  value=direct[field.name];
  if(field.name==='years_experience' && /catia|solidworks|fusion|python|java|c\+\+|cad|specific|software|technology/.test(label))value=undefined;
  if(!known(value)) {
    if(/first name|given name/.test(label))value=direct.first_name;
    else if(/last name|surname|family name/.test(label))value=direct.last_name;
    else if(/email/.test(label)&&field.type==='email')value=identity.email;
    else if(/phone/.test(label)&&field.type==='tel')value=identity.phone;
    else if(/^(?:how many )?(?:professional years of experience|years of professional experience|years of commercial experience)$/.test(label))value=professionalYears(profile);
    else if(field.multiple && /skills/.test(label))value=(field.options||[]).filter(o=>skills.includes(norm(o.value))||skills.includes(norm(o.label))).map(o=>o.value);
    else if(/fusion.*project/.test(label)) { const fact=facts.find(f=>(f.skills||[]).some(s=>norm(s)==='fusion 360'));if(fact?.statements?.length){value=`${fact.provenance}: ${fact.statements.join(' ')}`;source='VERIFIED_FACT';} }
    else if(field.type==='checkbox' && !/consent|agree|privacy|marketing|declar|future|commit/i.test(field.label)) { if(/cad|fusion/.test(label)&&skills.some(s=>/cad|fusion/.test(s)))value=true;else if(/python/.test(label)&&skills.includes('python'))value=true; }
  }
  if(!known(value)) {
    const entry=(answerMemory.answers||[]).find(a=>a.source==='USER'&&a.reusable===true&&a.reuse_approved===true&&(!a.scope?.country||country(a.scope.country)===country(job.country))&&(!a.scope?.role_family||a.scope.role_family===(job.role_family||job.metadata?.role_family))&&(norm(a.key)===key||norm(a.question_text)===label));
    if(entry){value=entry.value;source='ANSWER_MEMORY';}
  }
  if(!known(value)||(Array.isArray(value)&&!value.length))return null;
  if(field.options && !field.multiple) { const option=field.options.find(o=>norm(o.value)===norm(value)||norm(o.label)===norm(value));if(!option)return null;value=option.value; }
  if(field.type==='radio' && norm(field.value)!==norm(value))return {skip:true};
  return {value,source};
}

async function ask({repository,telegram,application,browser,sessionId,field,snapshot,type}) {
  const status=type==='CAPTCHA'?'CAPTCHA_WAIT':'NEEDS_USER';
  const pending={selector:field.selector,field_name:field.name,field_type:field.type,question:field.label,type,fingerprint:snapshot.fingerprint,draft_id:snapshot.draft_id,captcha_generation:snapshot.fields.find(f=>f.name==='captcha_generation')?.value};
  await transition(repository,application.application_id,status,{browser_session_id:sessionId,pending_question:pending,current_step:snapshot.current_step});
  await browser.call(`/sessions/${sessionId}/checkpoint`,{pending_question:pending});
  try {
    const requestId=await telegram.request(repository,application.application_id,type==='CAPTCHA'?'CAPTCHA: reply with the exact code shown in the attached screenshot.':field.label);
    pending.request_id=requestId;await repository.pool.query('UPDATE applications SET last_state=last_state||$2::jsonb WHERE application_id=$1',[application.application_id,{pending_question:pending}]);
    if(type==='CAPTCHA' && telegram.token && telegram.chatId){
      const shot=await browser.call(`/sessions/${sessionId}/screenshot`,{});const message=(await repository.pool.query('SELECT telegram_message_id FROM application_questions WHERE telegram_request_id=$1',[requestId])).rows[0];
      const form=new FormData();form.set('chat_id',telegram.chatId);form.set('caption',`CAPTCHA — application ${application.application_id}\nRequest ${requestId}\nReply to this photo with the exact code.`);form.set('photo',new Blob([await readFile(shot.path)],{type:'image/png'}),'captcha.png');if(message?.telegram_message_id)form.set('reply_parameters',JSON.stringify({message_id:message.telegram_message_id}));
      const response=await telegram.fetch(`https://api.telegram.org/bot${telegram.token}/sendPhoto`,{method:'POST',body:form,signal:AbortSignal.timeout(30000)});const result=await response.json();if(!response.ok||!result.ok)throw new Error('CAPTCHA_NOTIFICATION_FAILED');
      await repository.pool.query('UPDATE application_questions SET telegram_message_id=$2 WHERE telegram_request_id=$1',[requestId,result.result.message_id]);
    }
  } catch(error) { await repository.event('application',application.application_id,'HITL_NOTIFICATION_FAILED',{error:error.name}); }
  return {application_id:application.application_id,status,pending_question:pending};
}

export async function reverify({browser,job,applicationId}) {
  const opened=await browser.call('/sessions',{application_id:applicationId,url:job.canonical_url});
  try {const view=opened.snapshot;if(/job (?:is )?(?:closed|expired)|no longer accepting applications|position (?:is )?filled/i.test(view.text))return false;return view.title && (view.buttons.some(b=>b.href===job.application_url&&/apply/i.test(b.text)) || /apply|application/i.test(view.title));}
  finally{await browser.call(`/sessions/${opened.session_id}`,undefined,'DELETE');}
}

export async function runApplication({ repository, jobId, applicationId, profile, answerMemory = {}, telegram, browser = new BrowserClient(), config = browserConfig(), maxSteps = 30, verifyOpen = reverify }) {
  if(!profile.profile_id)throw new Error('PROFILE_ID_REQUIRED');
  const paused=(await repository.pool.query('SELECT paused FROM runtime_control WHERE id=true')).rows[0]?.paused;
  if(!config.enabled||paused)return {status:'PAUSED',started:false};
  const jobRow=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[jobId])).rows[0];if(!jobRow)throw new Error('JOB_NOT_FOUND');const job={...jobRow.metadata,...jobRow};
  let application=applicationId?(await repository.pool.query('SELECT * FROM applications WHERE application_id=$1 AND job_id=$2 AND candidate_profile_id=$3',[applicationId,jobId,profile.profile_id])).rows[0]:null;
  if(applicationId&&!application)throw new Error('APPLICATION_NOT_FOUND_FOR_PROFILE_AND_JOB');
  if(!application){
    const analysis=(await repository.pool.query('SELECT * FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[jobId])).rows[0];if(analysis?.decision!=='AUTO_APPLY')return {status:'REVIEW',started:false,reason:'ANALYSIS_NOT_AUTO_APPLY'};
    const cv=(await repository.pool.query('SELECT * FROM cv_versions WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[jobId])).rows[0];if(!cv?.qa_json?.pass)throw new Error('VERIFIED_CV_REQUIRED');
    application=(await repository.pool.query(`INSERT INTO applications(application_id,candidate_profile_id,job_id,cv_id,status,dry_run) VALUES($1,$2,$3,$4,'QUEUED',$5) ON CONFLICT(candidate_profile_id,job_id) DO UPDATE SET updated_at=applications.updated_at RETURNING *`,[randomUUID(),profile.profile_id,jobId,cv.cv_id,config.dryRun])).rows[0];
  }
  const mutex=await repository.pool.connect();let quotaLock=false;
  try {
    const locked=(await mutex.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[application.application_id])).rows[0].locked;if(!locked)return {application_id:application.application_id,status:'BUSY'};
    application=(await repository.pool.query('SELECT * FROM applications WHERE application_id=$1',[application.application_id])).rows[0];
    if(application.status==='SUBMITTING'){await transition(repository,application.application_id,'SUBMISSION_UNKNOWN',{reason:'INTERRUPTED_SUBMISSION_REQUIRES_RECONCILIATION'});return {application_id:application.application_id,status:'SUBMISSION_UNKNOWN'};}
    if(['SUBMITTED','SUBMISSION_UNKNOWN','SUBMITTING','SKIPPED','FAILED','MANUAL_TAKEOVER','ALREADY_APPLIED'].includes(application.status))return {application_id:application.application_id,status:application.status,confirmation_id:application.confirmation_id};
    const cv=(await repository.pool.query('SELECT * FROM cv_versions WHERE cv_id=$1',[application.cv_id])).rows[0];
    let sessionId=application.last_state?.browser_session_id, view;
    if(application.status==='QUEUED'||application.status==='OPENING') {if(application.status==='QUEUED'){await transition(repository,application.application_id,'OPENING');application.status='OPENING';}if(!await verifyOpen({browser,job,applicationId:application.application_id})){await transition(repository,application.application_id,'SKIPPED',{skip_reason:'JOB_CLOSED_OR_UNVERIFIED'});return {status:'SKIPPED',application_id:application.application_id};}const opened=await browser.call('/sessions',{application_id:application.application_id,url:job.application_url});sessionId=opened.session_id;view=opened.snapshot;await transition(repository,application.application_id,'FILLING',{browser_session_id:sessionId});application.status='FILLING';}
    else {try{view=await browser.call(`/sessions/${sessionId}/snapshot`);}catch{const recovery=await browser.call(`/sessions/${sessionId}/recover`,{});if(['SUBMITTED','SUBMISSION_UNKNOWN','MANUAL_TAKEOVER'].includes(recovery.status)){await transition(repository,application.application_id,recovery.status,{confirmation_id:recovery.confirmation_id});return {application_id:application.application_id,...recovery};}sessionId=recovery.session_id;view=recovery.snapshot;await repository.pool.query('UPDATE applications SET last_state=last_state||$2::jsonb WHERE application_id=$1',[application.application_id,{browser_session_id:sessionId}]);}}
    if(['NEEDS_USER','CAPTCHA_WAIT'].includes(application.status)){
      const pending=application.last_state.pending_question, answerRow=(await repository.pool.query('SELECT * FROM application_questions WHERE application_id=$1 AND telegram_request_id=$2 AND answered_at IS NOT NULL',[application.application_id,pending?.request_id])).rows[0];
      if(!answerRow)return {application_id:application.application_id,status:application.status};
      await transition(repository,application.application_id,'FILLING',{pending_question:null});application.status='FILLING';
      const field=view.fields.find(f=>f.selector===pending.selector);
      const generation=view.fields.find(f=>f.name==='captcha_generation')?.value;
      if(!field || (pending.type==='CAPTCHA'&&(view.draft_id!==pending.draft_id||generation!==pending.captcha_generation)))return ask({repository,telegram,application,browser,sessionId,field:field||{...pending,label:pending.question,type:pending.field_type},snapshot:view,type:pending.type});
      const answer=answerRow.answer;
      if(field.type==='checkbox'||field.type==='radio'){if(!/^(yes|agree|approved|true)$/i.test(String(answer)))return ask({repository,telegram,application,browser,sessionId,field,snapshot:view,type:'CONSENT'});view=await browser.call(`/sessions/${sessionId}/check`,{selector:field.selector,checked:true,approval:'USER_CONFIRMED'});}
      else if(field.options)view=await browser.call(`/sessions/${sessionId}/select`,{selector:field.selector,value:answer});
      else view=await browser.call(`/sessions/${sessionId}/fill`,{selector:field.selector,value:answer});
      await repository.event('application',application.application_id,'ANSWER_CONSUMED',{question_id:answerRow.question_id});
    }
    if(application.status==='READY_TO_SUBMIT'){await transition(repository,application.application_id,'FILLING',{reason:'REINSPECT_BEFORE_SUBMIT'});application.status='FILLING';}
    for(let count=0;count<maxSteps;count++){
      if(view.captcha){const field=view.fields.find(f=>f.visible&&/captcha/i.test(f.name||f.label));if(!field?.value)return ask({repository,telegram,application,browser,sessionId,field:field||{selector:null,label:'CAPTCHA requires human verification'},snapshot:view,type:'CAPTCHA'});}
      for(const field of view.fields.filter(f=>f.visible&&!['hidden','submit','button'].includes(f.type))){
        if(field.type==='file'){if(field.value)continue;if(!field.required)continue;if(!/\bcv\b|resume|curriculum vitae/i.test(field.name+' '+field.label)){await transition(repository,application.application_id,'MANUAL_TAKEOVER',{reason:'UNSUPPORTED_REQUIRED_DOCUMENT'});return {application_id:application.application_id,status:'MANUAL_TAKEOVER',reason:'UNSUPPORTED_REQUIRED_DOCUMENT'};}view=await browser.call(`/sessions/${sessionId}/upload`,{selector:field.selector,path:cv.pdf_path,sha256:cv.sha256});continue;}
        if(field.type==='checkbox' && /consent|privacy|agree|marketing|newsletter|future|declar|commitment/i.test(field.label)) {
          if(field.checked)continue;const consent=classifyConsent(field.label,field.required);if(consent.consent_type==='OPTIONAL_SKIP'||(!field.required&&consent.consent_type==='USER_REQUIRED'))continue;
          if(consent.consent_type==='USER_REQUIRED')return ask({repository,telegram,application,browser,sessionId,field,snapshot:view,type:'CONSENT'});
          view=await browser.call(`/sessions/${sessionId}/check`,{selector:field.selector,checked:true,verified_facts:true});await repository.pool.query('INSERT INTO consents(consent_id,application_id,consent_text,consent_text_hash,consent_type,source) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),application.application_id,consent.consent_text,consent.consent_text_hash,consent.consent_type,'RECRUITMENT_POLICY']);continue;
        }
        if(field.type==='checkbox' && field.checked || field.type==='radio' && field.checked)continue;
        if(!field.options && !['checkbox','radio'].includes(field.type)&&known(field.value))continue;
        const answer=resolveField(field,{profile,job,answerMemory});if(answer?.skip)continue;
        if(!answer){if(field.required)return ask({repository,telegram,application,browser,sessionId,field,snapshot:view,type:'FACT'});continue;}
        const operation=field.options?'select':['checkbox','radio'].includes(field.type)?'check':'fill';view=await browser.call(`/sessions/${sessionId}/${operation}`,{selector:field.selector,value:answer.value,checked:Boolean(answer.value),verified_facts:true});
      }
      view=await browser.call(`/sessions/${sessionId}/snapshot`);await repository.pool.query('UPDATE applications SET last_state=last_state||$2::jsonb WHERE application_id=$1',[application.application_id,{browser_session_id:sessionId,current_step:view.current_step,page_fingerprint:view.fingerprint,current_url:view.url}]);
      const final=view.buttons.find(b=>b.final_submit||/submit application|send application/i.test(b.text));
      if(final){
        const legalName=profile.onboarding?.legal_name||profile.candidate?.legal_name||profile.candidate?.name;
        const reviewFacts=[...(known(legalName)?String(legalName).split(/\s+/):[]),profile.onboarding?.email,job.title,path.basename(cv.pdf_path)];
        const outstanding=(await repository.pool.query('SELECT count(*)::int AS n FROM application_questions WHERE application_id=$1 AND answered_at IS NULL',[application.application_id])).rows[0].n;
        const uploaded=(view.uploaded_file_hashes||[]).some(file=>file.sha256===cv.sha256&&file.filename===path.basename(cv.pdf_path));
        if(!known(legalName)||reviewFacts.some(value=>!known(value)||!view.text.includes(String(value)))||!uploaded||outstanding||view.fields.some(f=>f.visible&&f.required&&f.validation_message)||!cv.qa_json?.pass){await transition(repository,application.application_id,'MANUAL_TAKEOVER',{reason:'FINAL_REVIEW_NOT_VERIFIED'});return {application_id:application.application_id,status:'MANUAL_TAKEOVER',reason:'FINAL_REVIEW_NOT_VERIFIED'};}
        if(application.status!=='READY_TO_SUBMIT'){await transition(repository,application.application_id,'READY_TO_SUBMIT',{browser_session_id:sessionId});application.status='READY_TO_SUBMIT';}
        const reason=submitPermission(view.url,config);if(reason){await repository.pool.query('UPDATE applications SET submit_blocked_reason=$2,dry_run=$3 WHERE application_id=$1',[application.application_id,reason,config.dryRun]);return {application_id:application.application_id,status:'READY_TO_SUBMIT',submit_blocked_reason:reason};}
        await mutex.query("SELECT pg_advisory_lock(hashtextextended('jobhunter-submission-quota',0))");quotaLock=true;
        const control=(await repository.pool.query('SELECT paused FROM runtime_control WHERE id=true')).rows[0];const tally=(await repository.pool.query("SELECT count(*)::int AS n FROM applications WHERE status IN ('SUBMITTING','SUBMITTED','SUBMISSION_UNKNOWN') AND COALESCE(submitted_at,updated_at)>=date_trunc('day',now() AT TIME ZONE 'Europe/Warsaw') AT TIME ZONE 'Europe/Warsaw'")).rows[0].n;
        if(control?.paused||!config.enabled||tally>=Number(config.maxApplicationsPerDay??process.env.MAX_APPLICATIONS_PER_DAY??20)){const reason=control?.paused||!config.enabled?'PAUSED':'DAILY_LIMIT';await repository.pool.query('UPDATE applications SET submit_blocked_reason=$2 WHERE application_id=$1',[application.application_id,reason]);return {application_id:application.application_id,status:'READY_TO_SUBMIT',submit_blocked_reason:reason};}
        if(!await verifyOpen({browser,job,applicationId:application.application_id})){await transition(repository,application.application_id,'SKIPPED',{skip_reason:'JOB_CLOSED_OR_UNVERIFIED'});return {status:'SKIPPED',application_id:application.application_id};}
        await transition(repository,application.application_id,'SUBMITTING',{browser_session_id:sessionId});application.status='SUBMITTING';let result;
        try{result=await browser.call(`/sessions/${sessionId}/submit`,{selector:final.selector});}catch{result={status:'SUBMISSION_UNKNOWN'};}
        if(result.status!=='SUBMITTED'||!result.confirmation_id||result.confirmation_evidence!=='NETWORK_AND_PAGE')result={...result,status:'SUBMISSION_UNKNOWN'};
        await transition(repository,application.application_id,result.status,{confirmation_id:result.confirmation_id});
        if(telegram?.send){try{await telegram.send(result.status==='SUBMITTED'?`✅ Application submitted\nCompany: ${job.company}\nRole: ${job.title}\nLocation: ${job.location??''}\nApplication ID: ${application.application_id}\nCV: ${path.basename(cv.pdf_path)}\nConfirmation: ${result.confirmation_id}\nSource: ${job.canonical_url}`:`SUBMISSION STATUS UNKNOWN\nCompany: ${job.company}\nRole: ${job.title}\nApplication: ${application.application_id}\nManual review required. Submit will not be repeated.`);await repository.event('application',application.application_id,'SUBMISSION_NOTIFICATION_SENT',{status:result.status});}catch{await repository.event('application',application.application_id,'SUBMISSION_NOTIFICATION_FAILED',{status:result.status});}}
        return {application_id:application.application_id,...result};
      }
      const next=view.buttons.find(b=>/^(next|continue)(\s+step)?$/i.test(b.text));if(!next){await transition(repository,application.application_id,'MANUAL_TAKEOVER',{reason:'UNSUPPORTED_FORM'});return {application_id:application.application_id,status:'MANUAL_TAKEOVER'};}
      const previous=view.current_step;view=await browser.call(`/sessions/${sessionId}/click`,{selector:next.selector});
      if(view.current_step===previous){const invalid=view.fields.find(f=>f.visible&&f.validation_message);if(invalid)return ask({repository,telegram,application,browser,sessionId,field:{...invalid,label:invalid.label+' — '+invalid.validation_message},snapshot:view,type:'VALIDATION'});await transition(repository,application.application_id,'MANUAL_TAKEOVER',{reason:'STEP_DID_NOT_ADVANCE',validation_errors:view.validation_errors});return {application_id:application.application_id,status:'MANUAL_TAKEOVER'};}
    }
    await transition(repository,application.application_id,'MANUAL_TAKEOVER',{reason:'MAX_FORM_STEPS'});return {application_id:application.application_id,status:'MANUAL_TAKEOVER'};
  } catch(error) {await repository.event('application',application.application_id,'APPLICATION_RUN_FAILED',{error:error.name,reason:error.message.slice(0,200)});const current=(await repository.pool.query('SELECT status FROM applications WHERE application_id=$1',[application.application_id])).rows[0]?.status;if(['OPENING','FILLING'].includes(current)){await transition(repository,application.application_id,'FAILED',{failure_reason:error.message.slice(0,200)});return {application_id:application.application_id,status:'FAILED',reason:error.message};}if(current==='SUBMITTING'){await transition(repository,application.application_id,'SUBMISSION_UNKNOWN');return {application_id:application.application_id,status:'SUBMISSION_UNKNOWN'};}return {application_id:application.application_id,status:current||'FAILED',reason:error.message};}
  finally { if(quotaLock)await mutex.query("SELECT pg_advisory_unlock(hashtextextended('jobhunter-submission-quota',0))");await mutex.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[application.application_id]);mutex.release(); }
}
