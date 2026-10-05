import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { transition } from './state.mjs';
import { browserConfig } from '../browser-service/server.mjs';
import {persistPendingApplicationQuestion} from './hitl.mjs';
import {employerAutomationPolicy} from './employer-policy.mjs';
import {settleApplicationForm} from './form-settling.mjs';
import {confirmedFieldMatches} from './confirmed-field.mjs';
import {enqueueCaptchaHandoff} from './captcha-handoff.mjs';
import {currentPreparationPolicy} from './preparation-policy.mjs';
import YAML from 'yaml';
import {isModelAnswerable,enqueue as enqueueProse,getReady as readyProse,consume as consumeProse} from './application-prose.mjs';
import {scopeApplicationForm} from '../browser-service/application-form-scope.mjs';
import {reusableQuestionAnswer} from './answer-memory.mjs';
import {atsAdapterFor,safeNavigationButton,finalSubmitLabel} from '../browser-service/ats-adapters.mjs';
export {employerAutomationPolicy} from './employer-policy.mjs';
import { controlledSubmitPermission, classifyConsent,isMockUrl } from '../browser-service/policy.mjs';
import {verifyCurrentCvEvidence} from './cv-evidence.mjs';

export class BrowserClient {
  constructor({ baseUrl = process.env.BROWSER_SERVICE_URL || 'http://127.0.0.1:3001', token = process.env.BROWSER_SERVICE_TOKEN, fetchImpl = fetch } = {}) { this.baseUrl=baseUrl; this.token=token; this.fetch=fetchImpl; }
  async call(endpoint, body, method = body ? 'POST' : 'GET') { if (!this.token) throw new Error('BROWSER_TOKEN_REQUIRED'); const response=await this.fetch(this.baseUrl+endpoint,{method,headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)}); const result=await response.json();if(!response.ok)throw new Error(result.error||'BROWSER_ACTION_FAILED');return result; }
}
const known = value => value !== undefined && value !== null && value !== '' && value !== 'UNKNOWN';
const norm = value => String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').toLowerCase().replace(/[^a-z0-9+#]+/g,' ').trim();
const country = value => /^(pl|poland|polska)$/i.test(value) ? 'PL' : String(value||'').toUpperCase();
export function finalReviewEvidence({view,profile,job,cv,outstanding=0}){
  const identity=profile.onboarding??{},name=identity.legal_name;
  const values=(view.fields??[]).filter(f=>f.visible&&!['password','hidden','file'].includes(f.type)).map(f=>String(f.value??''));
  const haystack=`${view.text??''}\n${values.join('\n')}`;
  const checks={identity:known(name)&&String(name).split(/\s+/).every(part=>haystack.includes(part))&&known(identity.email)&&haystack.includes(identity.email),
    job:(view.text??'').includes(job.title)||(view.title??'').includes(job.title),
    upload:(view.uploaded_file_hashes??[]).some(f=>f.sha256===cv.sha256&&f.filename===path.basename(cv.pdf_path)&&(f.evidence==='SERVER_UPLOAD_RECEIPT'||(view.text??'').includes(f.filename))),
    questions:outstanding===0,required_fields:!(view.fields??[]).some(f=>f.visible&&f.required&&(f.validation_message||(!f.value&&f.type!=='checkbox')||(f.type==='checkbox'&&!f.checked))),
    claims:cv.qa_json?.pass===true,policy:!employerAutomationPolicy(view),captcha:!view.captcha};
  return {pass:Object.values(checks).every(Boolean),checks,observed_at:new Date().toISOString(),form_fingerprint:view.fingerprint,cv_sha256:cv.sha256};
}

export function professionalYears(profile) {
  if(known(profile.candidate?.professional_years))return profile.candidate.professional_years;
  if((profile.experience||[]).some(f=>f.provenance==='PROFESSIONAL'&&(!f.exact_start_date||!f.exact_end_date)))return undefined;
  const intervals=(profile.experience||[]).filter(f=>f.provenance==='PROFESSIONAL' && f.exact_start_date && f.exact_end_date).map(f=>[Date.parse(f.exact_start_date),Date.parse(f.exact_end_date)+86400000]).filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>=a).sort((a,b)=>a[0]-b[0]);
  if (!intervals.length) return undefined;
  const merged=[];for(const interval of intervals){const last=merged.at(-1);if(last&&interval[0]<=last[1])last[1]=Math.max(last[1],interval[1]);else merged.push([...interval]);}
  return Math.floor(merged.reduce((n,[a,b])=>n+b-a,0)/86400000/365.25+0.01);
}

export function resolveField(field, { profile, job, answerMemory = {} }) {
  const identity=profile.onboarding||{}, candidate=profile.candidate||{}, key=norm(field.name), label=norm(String(field.label??'').replace(/\s+[a-f0-9]{8}\s*$/i,'')).replace(/\s+required$/,'').trim(), legal=identity.legal_name||candidate.legal_name||candidate.name;
  const skills=Object.values(profile.skills||{}).flat().map(norm), facts=[...(profile.experience||[]),...(profile.projects||[]),...(profile.education||[])];
  let value, source='PROFILE';
  if(/birth|born|urodze/.test(label)&&!['first_name','last_name','email','phone'].includes(field.name))return null;
  const nameParts=known(legal)?String(legal).trim().split(/\s+/):[];
  const direct={first_name:identity.first_name||(nameParts.length===2?nameParts[0]:undefined),last_name:identity.last_name||(nameParts.length===2?nameParts[1]:undefined),email:identity.email,phone:identity.phone,city:candidate.base_location?.city,country:candidate.base_location?.country,portfolio_url:identity.portfolio_url||identity.github_url,current_title:(profile.experience||[]).find(f=>f.provenance==='PROFESSIONAL')?.role,years_experience:professionalYears(profile),education:(profile.education||[]).filter(f=>f.provenance==='EDUCATION').map(f=>[f.degree,f.field,f.institution].filter(known).join(', ')).join('; '),start_date:identity.earliest_start_date,employment_type:candidate.availability?.full_time===true?'Full-time':undefined,authorized_poland:candidate.eu_citizen===true?'Yes':undefined,eu_authorized:candidate.eu_citizen===true?'yes':undefined};
  if(/linkedin/i.test(label)&&known(identity.linkedin_url)&&['text','url'].includes(field.type))return {value:identity.linkedin_url,source:'PROFILE'};
  value=direct[field.name];
  if(field.name==='name'&&field.type==='text')value=legal;
  if(field.name==='location'&&field.type==='text'&&known(candidate.base_location?.city)&&known(candidate.base_location?.country))value=`${candidate.base_location.city}, ${candidate.base_location.country}`;
  if(field.name==='years_experience' && /catia|solidworks|fusion|python|java|c\+\+|cad|specific|software|technology/.test(label))value=undefined;
  if(!known(value)) {
    if(/^(?:full name|legal name|name|imie i nazwisko)$/.test(label))value=legal;
    else if(/^(?:imie)$|first name|given name/.test(label))value=direct.first_name;
    else if(/^(?:nazwisko)$|last name|surname|family name/.test(label))value=direct.last_name;
    else if(/^(?:(?:e mail|email)(?: address)?|adres e mail)$/.test(label)&&['email','text'].includes(field.type))value=identity.email;
    else if(/^(?:phone|phone number|telephone|mobile(?: phone)?(?: number)?|telefon|numer telefonu)$/.test(label)&&['tel','text'].includes(field.type))value=identity.phone;
    else if(/^(?:city|miasto|miejscowosc|miasto zamieszkania|miejscowosc zamieszkania)$/.test(label))value=candidate.base_location?.city;
    else if(/^(?:country|country of residence|kraj|kraj zamieszkania)$/.test(label))value=candidate.base_location?.country;
    else if(/^(?:current title|current job title|obecne stanowisko|aktualne stanowisko)$/.test(label))value=direct.current_title;
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
  if(field.options && !field.multiple) { const choice=v=>/^(?:yes|tak|true)$/.test(norm(v))?'YES':/^(?:no|nie|false)$/.test(norm(v))?'NO':country(v)==='PL'?'PL':norm(v);const option=field.options.find(o=>choice(o.value)===choice(value)||choice(o.label)===choice(value));if(!option)return null;value=option.value; }
  if(value===identity.phone&&field.max_length===9&&country(job.country)==='PL'&&/^\+48\d{9}$/.test(value))value=value.slice(3);
  if(field.type==='radio' && norm(field.value)!==norm(value))return {skip:true};
  return {value,source};
}

async function ask({repository,telegram,application,browser,sessionId,field,snapshot,type}) {
  const status=type==='CAPTCHA'?'CAPTCHA_WAIT':'NEEDS_USER';
  const pending={selector:field.selector,field_name:field.name,field_type:field.type,field_label:snapshot.fields.find(f=>f.selector===field.selector)?.label??field.label,question:field.label,type,fingerprint:snapshot.fingerprint,draft_id:snapshot.draft_id,captcha_generation:snapshot.fields.find(f=>f.name==='captcha_generation')?.value};
  await transition(repository,application.application_id,status,{browser_session_id:sessionId,pending_question:pending,current_step:snapshot.current_step});
  const question=await persistPendingApplicationQuestion(repository,{applicationId:application.application_id,rawQuestion:field.label,chatId:telegram?.chatId??null});
  pending.request_id=question.telegram_request_id;
  await browser.call(`/sessions/${sessionId}/checkpoint`,{pending_question:pending});
  try {
    const requestId=await telegram.request(repository,application.application_id,field.label);
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

export function postingOpenEvidence(view,job){
 if(view.captcha||/^(?:access denied|forbidden|just a moment)/i.test(view.title??''))return 'UNKNOWN';
 if(/job (?:is )?(?:closed|expired)|no longer accepting applications|position (?:is )?filled|oferta (?:pracy )?(?:jest )?(?:nieaktualna|wygasla|wygasła)|ogloszenie wygaslo|ogłoszenie wygasło/i.test(view.text??''))return 'CLOSED';
 const title=norm(job.title),body=norm(view.text),label=norm(view.title);
 let samePage=false;try{const actual=new URL(view.url),expected=new URL(job.canonical_url);samePage=actual.origin===expected.origin&&actual.pathname===expected.pathname;}catch{}
 const identified=!!title&&(body.includes(title)||label.includes(title));
 const apply=(view.buttons??[]).some(button=>button.visible!==false&&!button.disabled&&/^(?:apply(?: now| for (?:this|the) (?:job|position))?|easy apply|aplikuj(?: teraz| szybko)?|latwe aplikowanie)$/i.test(norm(button.text)));
 return samePage&&identified&&apply?'OPEN':'UNKNOWN';
}
export function radioGroupAnswered(field,fields){
 return field.type==='radio'&&!!field.name&&fields.some(other=>other.type==='radio'&&other.name===field.name&&other.form===field.form&&other.checked&&other.visible!==false&&!other.disabled);
}
export function humanConsentAnswer(value){
 const text=String(value??'').trim().replace(/[.!]$/,'').trim();
 if(/^(?:yes|agree|approved|true|tak|да|согласен|согласна|разрешаю(?: для этой заявки)?)$/iu.test(text))return true;
 if(/^(?:no|false|nie|нет|отказываюсь|не согласен|не согласна|не разрешаю(?:\s*[—-]\s*пропустить заявку)?)$/iu.test(text))return false;
 return null;
}
function acknowledgementContext(view,job,profile,cv){return {
 job_id:job.job_id,job_content_hash:job.content_hash??null,job_country:job.country??null,job_location:job.location??null,
 profile_hash:createHash('sha256').update(JSON.stringify(profile)).digest('hex'),cv_sha256:cv.sha256,
 policy_links:JSON.stringify((view.buttons??[]).filter(button=>button.href&&/regulamin|terms|privacy|polityk/i.test(button.text)).map(button=>button.href).sort()),
};}
export async function reverify({browser,job,applicationId}) {
  const opened=await browser.call('/sessions',{application_id:applicationId,url:job.canonical_url});
  try {const evidence=postingOpenEvidence(opened.snapshot,job);return evidence==='OPEN'?true:evidence==='CLOSED'?false:null;}
  finally{await browser.call(`/sessions/${opened.session_id}`,undefined,'DELETE');}
}

export async function runApplication({ repository, jobId, applicationId, profile, policy, answerMemory = {}, telegram, browser = new BrowserClient(), config = browserConfig(), maxSteps = 30, verifyOpen = reverify }) {
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
    if(!isMockUrl(new URL(job.canonical_url),config)){
      const latest=(await repository.pool.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[jobId])).rows[0]?.analysis_json;
      const currentPolicy=policy??YAML.parse(await readFile('config/search_policy.yaml','utf8'));
      const scope=currentPreparationPolicy({job,profile,policy:currentPolicy,analysis:latest,cv});
      if(!scope.pass){await repository.event('application',application.application_id,'PREPARATION_POLICY_REJECTED',{reason:scope.reason,decision:scope.decision});
        if(scope.decision==='REJECT'){await transition(repository,application.application_id,'SKIPPED',{skip_reason:scope.reason});return {application_id:application.application_id,status:'SKIPPED',reason:scope.reason};}
        return {application_id:application.application_id,status:application.status,started:false,reason:scope.reason};}
      const evidence=await verifyCurrentCvEvidence({cv,job,profile,analysis:latest,artifactRoot:config.artifactRoot});
      if(!evidence.pass){await repository.event('application',application.application_id,'PREPARATION_EVIDENCE_REJECTED',{reasons:evidence.reasons});return {application_id:application.application_id,status:application.status,started:false,reason:'CURRENT_EMPLOYER_READY_CV_REQUIRED'};}
    }
    let sessionId=application.last_state?.browser_session_id, view;
    if(application.status==='QUEUED'||application.status==='OPENING') {
      if(application.status==='QUEUED'){await transition(repository,application.application_id,'OPENING');application.status='OPENING';}
      const open=await verifyOpen({browser,job,applicationId:application.application_id});
      if(open!==true){const status=open===false?'SKIPPED':'MANUAL_TAKEOVER';await transition(repository,application.application_id,status,open===false?{skip_reason:'JOB_CONFIRMED_CLOSED'}:{reason:'JOB_OPEN_VERIFICATION_UNCERTAIN'});return {status,application_id:application.application_id};}
      const opened=await browser.call('/sessions',{application_id:application.application_id,url:job.application_url});sessionId=opened.session_id;
      await repository.pool.query('UPDATE applications SET last_state=last_state||$2::jsonb WHERE application_id=$1',[application.application_id,{browser_session_id:sessionId}]);
      view=await settleApplicationForm({browser,sessionId,initialView:opened.snapshot});await transition(repository,application.application_id,'FILLING',{browser_session_id:sessionId});application.status='FILLING';}
    else {try{view=await browser.call(`/sessions/${sessionId}/snapshot`);}catch{const recovery=await browser.call(`/sessions/${sessionId}/recover`,{});if(['SUBMITTED','SUBMISSION_UNKNOWN','MANUAL_TAKEOVER'].includes(recovery.status)){await transition(repository,application.application_id,recovery.status,{confirmation_id:recovery.confirmation_id});return {application_id:application.application_id,...recovery};}sessionId=recovery.session_id;view=recovery.snapshot;await repository.pool.query('UPDATE applications SET last_state=last_state||$2::jsonb WHERE application_id=$1',[application.application_id,{browser_session_id:sessionId}]);}}
    const initialScope=scopeApplicationForm(view);
    if(!initialScope.pass){await transition(repository,application.application_id,'MANUAL_TAKEOVER',{reason:initialScope.reason});return {application_id:application.application_id,status:'MANUAL_TAKEOVER',reason:initialScope.reason};}
    view=initialScope.view;
    if(['NEEDS_USER','CAPTCHA_WAIT'].includes(application.status)){
      const pending=application.last_state.pending_question, answerRow=(await repository.pool.query('SELECT * FROM application_questions WHERE application_id=$1 AND telegram_request_id=$2 AND answered_at IS NOT NULL',[application.application_id,pending?.request_id])).rows[0];
      if(!answerRow)return {application_id:application.application_id,status:application.status};
      await transition(repository,application.application_id,'FILLING',{pending_question:null});application.status='FILLING';
      const field=view.fields.find(f=>f.selector===pending.selector);
      const generation=view.fields.find(f=>f.name==='captcha_generation')?.value;
      if(!field || !field.visible || field.disabled || view.fingerprint!==pending.fingerprint || field.label!==(pending.field_label??pending.question) || field.type!==pending.field_type || (pending.type==='CAPTCHA'&&(view.draft_id!==pending.draft_id||generation!==pending.captcha_generation)))return ask({repository,telegram,application,browser,sessionId,field:field||{...pending,label:pending.question,type:pending.field_type},snapshot:view,type:pending.type});
      const answer=answerRow.answer;
      if(field.type==='checkbox'||field.type==='radio'){
        const consent=humanConsentAnswer(answer);
        if(consent===false&&field.required&&pending.type==='CONSENT'){
          await transition(repository,application.application_id,'SKIPPED',{skip_reason:'USER_DECLINED_REQUIRED_CONSENT',pending_question:null});return {application_id:application.application_id,status:'SKIPPED',reason:'USER_DECLINED_REQUIRED_CONSENT'};
        }
        if(consent!==true)return ask({repository,telegram,application,browser,sessionId,field,snapshot:view,type:'CONSENT'});
        view=await browser.call(`/sessions/${sessionId}/check`,{selector:field.selector,checked:true,approval:'USER_CONFIRMED'});
      }
      else if(field.options)view=await browser.call(`/sessions/${sessionId}/select`,{selector:field.selector,value:answer});
      else view=await browser.call(`/sessions/${sessionId}/fill`,{selector:field.selector,value:answer});
      const observed=view.fields.find(f=>f.selector===field.selector);
      if(observed){
        const confirmed={label:observed.label,type:observed.type,value:observed.value,checked:observed.checked,fingerprint:view.fingerprint,question_id:answerRow.question_id,
          question_type:pending.type,page_url:view.url,form_action:observed.form_action??null,required:observed.required,
          context:acknowledgementContext(view,job,profile,cv)};
        application.last_state.confirmed_fields={...(application.last_state.confirmed_fields??{}),[field.selector]:confirmed};
        await repository.pool.query('UPDATE applications SET last_state=last_state||$2::jsonb WHERE application_id=$1',[application.application_id,{confirmed_fields:application.last_state.confirmed_fields}]);
      }
      await repository.event('application',application.application_id,'ANSWER_CONSUMED',{question_id:answerRow.question_id});
    }
    if(application.status==='READY_TO_SUBMIT'){await transition(repository,application.application_id,'FILLING',{reason:'REINSPECT_BEFORE_SUBMIT'});application.status='FILLING';}
    for(let count=0;count<maxSteps;count++){
      const entry=view.buttons?.find(button=>safeNavigationButton({adapter:atsAdapterFor(view.url),url:view.url,button,fields:view.fields??[]}));
      if(entry&&!view.fields?.some(f=>f.type==='file')){
        view=entry.href?await browser.call(`/sessions/${sessionId}/navigate`,{url:new URL(entry.href,view.url).href}):await browser.call(`/sessions/${sessionId}/click`,{selector:entry.selector});
        view=await settleApplicationForm({browser,sessionId,initialView:view});continue;
      }
      const stepScope=scopeApplicationForm(view);
      if(!stepScope.pass){await transition(repository,application.application_id,'MANUAL_TAKEOVER',{reason:stepScope.reason});return {application_id:application.application_id,status:'MANUAL_TAKEOVER',reason:stepScope.reason};}
      view=stepScope.view;
      const employerPolicy=employerAutomationPolicy(view);
      if(employerPolicy){await transition(repository,application.application_id,'MANUAL_TAKEOVER',{reason:employerPolicy,browser_session_id:sessionId,current_url:view.url});return {application_id:application.application_id,status:'MANUAL_TAKEOVER',reason:employerPolicy};}
      const authentication=view.fields.some(f=>f.visible&&(f.type==='password'||/^(?:otp|totp|2fa|authentication_code|webauthn)$/i.test(f.name??'')));
      if(authentication){await transition(repository,application.application_id,'MANUAL_TAKEOVER',{reason:'AUTHENTICATION_REQUIRED',browser_session_id:sessionId,current_url:view.url});if(telegram?.send)await telegram.send(`MANUAL TAKEOVER REQUIRED\nApplication: ${application.application_id}\nCompany: ${job.company}\nRole: ${job.title}\nReason: authentication or security verification\nSession: ${sessionId}\nURL: ${view.url}`);return {application_id:application.application_id,status:'MANUAL_TAKEOVER',reason:'AUTHENTICATION_REQUIRED'};}
      if(view.captcha){const field=view.fields.find(f=>f.visible&&/captcha/i.test(f.name||f.label)&&['text','textarea'].includes(f.type));if(!field){await transition(repository,application.application_id,'MANUAL_TAKEOVER',{reason:'INTERACTIVE_CAPTCHA',browser_session_id:sessionId,current_url:view.url});try{await enqueueCaptchaHandoff({repository,applicationId:application.application_id,sessionId,snapshot:view,chatId:telegram?.chatId});}catch{await repository.event('application',application.application_id,'CAPTCHA_HANDOFF_PERSIST_FAILED',{reason:'DURABLE_HANDOFF_REQUIRED'});}return {application_id:application.application_id,status:'MANUAL_TAKEOVER',reason:'INTERACTIVE_CAPTCHA'};}if(!field.value)return ask({repository,telegram,application,browser,sessionId,field,snapshot:view,type:'CAPTCHA'});}
      const fieldsToFill=view.fields.filter(f=>!f.disabled&&!f.readOnly&&(f.visible||(f.type==='file'&&/resume|\bcv\b|curriculum/i.test(f.name+' '+f.label+' '+f.selector)))&&!['hidden','submit','button'].includes(f.type));
      fieldsToFill.sort((a,b)=>Number(a.type==='textarea'&&!a.required)-Number(b.type==='textarea'&&!b.required));
      for(const field of fieldsToFill){
        if(confirmedFieldMatches(field,view,application.last_state?.confirmed_fields?.[field.selector],acknowledgementContext(view,job,profile,cv)))continue;
        if(field.type==='file'){
          const praca=atsAdapterFor(view.url)==='praca',confirmed=view.uploaded_file_hashes?.some(upload=>upload.sha256===cv.sha256&&upload.evidence==='SERVER_UPLOAD_RECEIPT');
          if(field.value&&(!praca||confirmed))continue;
          const resume=/\bcv\b|resume|curriculum vitae/i.test(field.name+' '+field.label+' '+field.selector);
          if(!field.required&&!resume)continue;
          if(!resume){await transition(repository,application.application_id,'MANUAL_TAKEOVER',{reason:'UNSUPPORTED_REQUIRED_DOCUMENT'});return {application_id:application.application_id,status:'MANUAL_TAKEOVER',reason:'UNSUPPORTED_REQUIRED_DOCUMENT'};}
          view=await browser.call(`/sessions/${sessionId}/upload`,{selector:field.selector,path:cv.pdf_path,sha256:cv.sha256});
          if(praca&&!view.uploaded_file_hashes?.some(upload=>upload.sha256===cv.sha256&&upload.evidence==='SERVER_UPLOAD_RECEIPT')){await transition(repository,application.application_id,'MANUAL_TAKEOVER',{reason:'CV_UPLOAD_UNCONFIRMED'});return {application_id:application.application_id,status:'MANUAL_TAKEOVER',reason:'CV_UPLOAD_UNCONFIRMED'};}
          continue;
        }
        if(field.type==='checkbox' && /consent|privacy|agree|marketing|newsletter|future|declar|commitment|zgod|regulamin|zapozn|oświadcz|oswiadcz|przetwarzan/iu.test(field.label)) {
          const consent=classifyConsent(field.label,field.required);
          if(consent.consent_type==='OPTIONAL_SKIP'||(!field.required&&consent.consent_type==='USER_REQUIRED')){if(field.checked)view=await browser.call(`/sessions/${sessionId}/check`,{selector:field.selector,checked:false});continue;}
          if(consent.consent_type==='USER_REQUIRED')return ask({repository,telegram,application,browser,sessionId,field,snapshot:view,type:'CONSENT'});
          if(field.checked)continue;
          view=await browser.call(`/sessions/${sessionId}/check`,{selector:field.selector,checked:true,verified_facts:true});await repository.pool.query('INSERT INTO consents(consent_id,application_id,consent_text,consent_text_hash,consent_type,source) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),application.application_id,consent.consent_text,consent.consent_text_hash,consent.consent_type,'RECRUITMENT_POLICY']);continue;
        }
        if(field.type==='checkbox' && field.checked || radioGroupAnswered(field,view.fields))continue;
        if(!field.options && !['checkbox','radio'].includes(field.type)&&known(field.value))continue;
        const answer=resolveField(field,{profile,job,answerMemory})??await reusableQuestionAnswer(repository,{profileId:profile.profile_id,field,job});if(answer?.skip)continue;
        if(!answer){
          if(isModelAnswerable(field)){
            const prosePolicy=policy??YAML.parse(await readFile('config/search_policy.yaml','utf8'));
            const input={repo:repository,appId:application.application_id,field,view,profile,job,policy:prosePolicy};
            const draft=await readyProse(input);
            if(draft){view=await browser.call(`/sessions/${sessionId}/fill`,{selector:field.selector,value:draft.text_answer,verified_facts:true});await consumeProse({repo:repository,draftId:draft.draft_id,appId:application.application_id});continue;}
            const queued=await enqueueProse(input);
            if(queued.status==='REJECTED'&&field.required)return ask({repository,telegram,application,browser,sessionId,field,snapshot:view,type:'FACT'});
            if(queued.status==='REJECTED')continue;
            await repository.pool.query('UPDATE applications SET last_state=last_state||$2::jsonb WHERE application_id=$1',[application.application_id,{prose_pending_question:{selector:field.selector,field_label:field.label,fingerprint:view.fingerprint,draft_id:queued.draft_id},pending_question:null}]);
            return {application_id:application.application_id,status:'FILLING',prose_pending:true,draft_id:queued.draft_id};
          }
          if(field.required)return ask({repository,telegram,application,browser,sessionId,field,snapshot:view,type:'FACT'});continue;
        }
        const operation=field.options?'select':['checkbox','radio'].includes(field.type)?'check':'fill';view=await browser.call(`/sessions/${sessionId}/${operation}`,{selector:field.selector,value:answer.value,checked:Boolean(answer.value),verified_facts:true});
        if(answer.memory_id)await repository.event('application',application.application_id,'ANSWER_MEMORY_APPLIED',{memory_id:answer.memory_id,version:answer.memory_version,field_name:field.name});
      }
      view=await browser.call(`/sessions/${sessionId}/snapshot`);await repository.pool.query('UPDATE applications SET last_state=last_state||$2::jsonb WHERE application_id=$1',[application.application_id,{browser_session_id:sessionId,current_step:view.current_step,page_fingerprint:view.fingerprint,current_url:view.url}]);
      const finalScope=scopeApplicationForm(view);
      if(!finalScope.pass){await transition(repository,application.application_id,'MANUAL_TAKEOVER',{reason:finalScope.reason});return {application_id:application.application_id,status:'MANUAL_TAKEOVER',reason:finalScope.reason};}
      view=finalScope.view;
      const final=view.buttons.find(b=>b.final_submit||finalSubmitLabel(b.text));
      if(final){
        const legalName=profile.onboarding?.legal_name||profile.candidate?.legal_name||profile.candidate?.name;
        const reviewFacts=[...(known(legalName)?String(legalName).split(/\s+/):[]),profile.onboarding?.email,job.title,path.basename(cv.pdf_path)];
        const outstanding=(await repository.pool.query('SELECT count(*)::int AS n FROM application_questions WHERE application_id=$1 AND answered_at IS NULL',[application.application_id])).rows[0].n;
        const review=finalReviewEvidence({view,profile,job,cv,outstanding});
        if(!review.pass){await transition(repository,application.application_id,'MANUAL_TAKEOVER',{reason:'FINAL_REVIEW_NOT_VERIFIED',final_review:review});return {application_id:application.application_id,status:'MANUAL_TAKEOVER',reason:'FINAL_REVIEW_NOT_VERIFIED'};}
        await repository.pool.query('UPDATE applications SET last_state=last_state||$2::jsonb WHERE application_id=$1',[application.application_id,{final_review:review}]);
        if(application.status!=='READY_TO_SUBMIT'){await transition(repository,application.application_id,'READY_TO_SUBMIT',{browser_session_id:sessionId});application.status='READY_TO_SUBMIT';}
        const reason=controlledSubmitPermission(view.url,config);if(reason){await repository.pool.query('UPDATE applications SET submit_blocked_reason=$2,dry_run=$3 WHERE application_id=$1',[application.application_id,reason,config.dryRun]);return {application_id:application.application_id,status:'READY_TO_SUBMIT',submit_blocked_reason:reason};}
        await mutex.query("SELECT pg_advisory_lock(hashtextextended('jobhunter-submission-quota',0))");quotaLock=true;
        const control=(await repository.pool.query('SELECT paused FROM runtime_control WHERE id=true')).rows[0];const tally=(await repository.pool.query("SELECT count(*)::int AS n FROM applications WHERE status IN ('SUBMITTING','SUBMITTED','SUBMISSION_UNKNOWN') AND COALESCE(submitted_at,updated_at)>=date_trunc('day',now() AT TIME ZONE 'Europe/Warsaw') AT TIME ZONE 'Europe/Warsaw'")).rows[0].n;
        if(control?.paused||!config.enabled||tally>=Number(config.maxApplicationsPerDay??process.env.MAX_APPLICATIONS_PER_DAY??20)){const reason=control?.paused||!config.enabled?'PAUSED':'DAILY_LIMIT';await repository.pool.query('UPDATE applications SET submit_blocked_reason=$2 WHERE application_id=$1',[application.application_id,reason]);return {application_id:application.application_id,status:'READY_TO_SUBMIT',submit_blocked_reason:reason};}
        const open=await verifyOpen({browser,job,applicationId:application.application_id});
        if(open!==true){const status=open===false?'SKIPPED':'MANUAL_TAKEOVER';await transition(repository,application.application_id,status,open===false?{skip_reason:'JOB_CONFIRMED_CLOSED'}:{reason:'JOB_OPEN_VERIFICATION_UNCERTAIN'});return {status,application_id:application.application_id};}
        await transition(repository,application.application_id,'SUBMITTING',{browser_session_id:sessionId});application.status='SUBMITTING';let result;
        try{result=await browser.call(`/sessions/${sessionId}/submit`,{selector:final.selector});}catch{result={status:'SUBMISSION_UNKNOWN'};}
        if(result.status!=='SUBMITTED'||!result.confirmation_id||result.confirmation_evidence!=='NETWORK_AND_PAGE')result={...result,status:'SUBMISSION_UNKNOWN'};
        await transition(repository,application.application_id,result.status,{confirmation_id:result.confirmation_id});
        if(telegram?.send){try{await telegram.send(result.status==='SUBMITTED'?`✅ Application submitted\nCompany: ${job.company}\nRole: ${job.title}\nLocation: ${job.location??''}\nApplication ID: ${application.application_id}\nCV: ${path.basename(cv.pdf_path)}\nConfirmation: ${result.confirmation_id}\nSource: ${job.canonical_url}`:`SUBMISSION STATUS UNKNOWN\nCompany: ${job.company}\nRole: ${job.title}\nApplication: ${application.application_id}\nManual review required. Submit will not be repeated.`);await repository.event('application',application.application_id,'SUBMISSION_NOTIFICATION_SENT',{status:result.status});}catch{await repository.event('application',application.application_id,'SUBMISSION_NOTIFICATION_FAILED',{status:result.status});}}
        return {application_id:application.application_id,...result};
      }
      const next=view.buttons.find(b=>/^(?:next|continue)(\s+step)?$|^(?:dalej|kontynuuj|nastepny krok)$/i.test(norm(b.text)));if(!next){await transition(repository,application.application_id,'MANUAL_TAKEOVER',{reason:'UNSUPPORTED_FORM'});return {application_id:application.application_id,status:'MANUAL_TAKEOVER'};}
      const previous=view.current_step;view=await browser.call(`/sessions/${sessionId}/click`,{selector:next.selector});
      if(view.current_step===previous){const invalid=view.fields.find(f=>f.visible&&f.validation_message);if(invalid)return ask({repository,telegram,application,browser,sessionId,field:{...invalid,label:invalid.label+' — '+invalid.validation_message},snapshot:view,type:'VALIDATION'});await transition(repository,application.application_id,'MANUAL_TAKEOVER',{reason:'STEP_DID_NOT_ADVANCE',validation_errors:view.validation_errors});return {application_id:application.application_id,status:'MANUAL_TAKEOVER'};}
    }
    await transition(repository,application.application_id,'MANUAL_TAKEOVER',{reason:'MAX_FORM_STEPS'});return {application_id:application.application_id,status:'MANUAL_TAKEOVER'};
  } catch(error) {await repository.event('application',application.application_id,'APPLICATION_RUN_FAILED',{error:error.name,reason:error.message.slice(0,200)});const current=(await repository.pool.query('SELECT status FROM applications WHERE application_id=$1',[application.application_id])).rows[0]?.status;if(['OPENING','FILLING'].includes(current)){await transition(repository,application.application_id,'FAILED',{failure_reason:error.message.slice(0,200)});return {application_id:application.application_id,status:'FAILED',reason:error.message};}if(current==='SUBMITTING'){await transition(repository,application.application_id,'SUBMISSION_UNKNOWN');return {application_id:application.application_id,status:'SUBMISSION_UNKNOWN'};}return {application_id:application.application_id,status:current||'FAILED',reason:error.message};}
  finally { if(quotaLock)await mutex.query("SELECT pg_advisory_unlock(hashtextextended('jobhunter-submission-quota',0))");await mutex.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[application.application_id]);mutex.release(); }
}
