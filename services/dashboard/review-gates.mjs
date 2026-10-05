import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { hitlError } from '../core/hitl.mjs';
import {employerAutomationPolicy} from '../core/employer-policy.mjs';

export const REVIEW_CAMPAIGN = 'MANUAL_REVIEW_V1';
export const REVIEW_APPLICATION_LIMIT = 10;
export const REVIEW_TTL_MS = 15 * 60000;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
export const activeProfileDigest = profile => digest(JSON.stringify(profile));
export function formBinding(snapshot) {
  return { session_id: snapshot.browser_session_id, url: snapshot.url, fingerprint: snapshot.fingerprint, current_step: snapshot.current_step,
    fields: (snapshot.fields ?? []).map(field => ({ selector: field.selector, name: field.name, label:field.label,type: field.type, value: field.value, checked: field.checked, required: field.required, visible:field.visible,disabled:field.disabled,readOnly:field.readOnly,form:field.form,form_id:field.form_id,form_selector:field.form_selector,options: field.options })),
    buttons:(snapshot.buttons??[]).map(button=>({selector:button.selector,text:button.text,type:button.type,href:button.href,visible:button.visible,disabled:button.disabled,name:button.name,value:button.value,formAction:button.formAction,formMethod:button.formMethod,form_action:button.form_action,form_method:button.form_method,form:button.form,form_id:button.form_id,form_selector:button.form_selector})),
    forms:snapshot.forms??null,form_action:snapshot.form_action,form_destination:snapshot.form_destination,
    uploaded_file_hashes: snapshot.uploaded_file_hashes ?? [] };
}
export function validateReviewContext({ application, job, cv, profile, snapshot, now = Date.now() }) {
  if (!profile?.profile_id || application?.candidate_profile_id !== profile.profile_id) throw hitlError('REVIEW_NOT_FOR_ACTIVE_PROFILE');
  if (application.status !== 'READY_TO_SUBMIT' || application.last_state?.pending_question) throw hitlError('APPLICATION_NOT_READY_FOR_REVIEW');
  const verifiedAt = new Date(job?.last_verified_open_at ?? '').getTime();
  if (job?.availability_status !== 'OPEN' || !Number.isFinite(verifiedAt) || now - verifiedAt > REVIEW_TTL_MS || verifiedAt > now + 60000) throw hitlError('VACANCY_REVERIFICATION_REQUIRED');
  if (!cv || cv.job_id !== application.job_id || cv.cv_id !== application.cv_id || cv.qa_json?.pass !== true || cv.qa_json?.claims?.pass !== true || cv.qa_json?.identity?.pass !== true || cv.qa_json?.pdf?.pass !== true) throw hitlError('FULL_VERIFIED_CV_REQUIRED');
  if(cv.manifest_json?.application_eligible!==true || Object.hasOwn(cv.manifest_json,'application_policy_blocker'))throw hitlError('CV_NOT_APPLICATION_ELIGIBLE');
  if (cv.profile_version !== activeProfileDigest(profile)) throw hitlError('CV_PROFILE_VERSION_STALE');
  if(cv.manifest_json.profile_hash!==activeProfileDigest(profile))throw hitlError('CV_PROFILE_HASH_STALE_OR_MISSING');
  if(!job.content_hash || cv.manifest_json.job_content_hash!==job.content_hash)throw hitlError('CV_JOB_CONTENT_HASH_STALE_OR_MISSING');
  if (!snapshot || snapshot.browser_session_id !== application.last_state?.browser_session_id || !snapshot.fingerprint || !Array.isArray(snapshot.fields) || snapshot.captcha || snapshot.validation_errors?.length || snapshot.fields.some(f => f.visible && (f.type === 'password' || /token|otp|totp|authentication.code/i.test(f.name ?? '') && f.type !== 'hidden'))) throw hitlError('BROWSER_REVIEW_REQUIRES_MANUAL_ASSISTANCE');
  if (!/^https:\/\//i.test(snapshot.url ?? '')) throw hitlError('HTTPS_APPLICATION_FORM_REQUIRED');
  if(!Array.isArray(snapshot.forms)||!Array.isArray(snapshot.buttons))throw hitlError('FORM_DESTINATION_METADATA_REQUIRED');
  if (job.metadata?.employer_policy?.ai_content_disallowed === true || employerAutomationPolicy(snapshot)) throw hitlError('EMPLOYER_AI_ATTESTATION_REQUIRES_MANUAL_REVIEW');
  if (snapshot.fields.some(f => f.visible && f.required && !f.disabled && (f.type === 'checkbox' ? f.checked !== true : f.type==='radio' ? f.checked!==true&&!snapshot.fields.some(other=>other.type==='radio'&&other.checked===true&&!other.disabled&&other.visible!==false&&Boolean(f.name)&&other.name===f.name&&(other.form_selector??other.form_id??other.form??null)===(f.form_selector??f.form_id??f.form??null)) : !f.value))) throw hitlError('REQUIRED_FORM_ANSWER_MISSING');
  if ((snapshot.uploaded_file_hashes?.length || snapshot.fields.some(f=>f.visible&&f.type==='file'&&/resume|\bcv\b/i.test(`${f.name??''} ${f.label??''}`))) && !snapshot.uploaded_file_hashes?.some(file=>file.sha256===cv.sha256)) throw hitlError('UPLOADED_CV_DOES_NOT_MATCH_REVIEW');
}
async function buildBinding(repository, applicationId, profile, browser) {
  const application = (await repository.pool.query('SELECT * FROM applications WHERE application_id=$1', [applicationId])).rows[0];
  if (!application || application.candidate_profile_id !== profile.profile_id) throw hitlError('APPLICATION_NOT_FOUND', 404);
  const job = (await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1', [application.job_id])).rows[0];
  const cv = (await repository.pool.query('SELECT * FROM cv_versions WHERE cv_id=$1', [application.cv_id])).rows[0];
  if (!application.last_state?.browser_session_id) throw hitlError('BROWSER_SESSION_REQUIRED');
  const snapshot = await browser.call(`/sessions/${application.last_state.browser_session_id}/snapshot`);
  validateReviewContext({ application, job, cv, profile, snapshot });
  const unresolved = (await repository.pool.query('SELECT question_id FROM application_questions WHERE application_id=$1 AND answered_at IS NULL AND closed_at IS NULL LIMIT 1', [applicationId])).rows;
  if (unresolved.length) throw hitlError('UNANSWERED_APPLICATION_QUESTION');
  const file = await realpath(cv.pdf_path), root = await realpath('data');
  if (!file.startsWith(root + path.sep)) throw hitlError('UNAPPROVED_CV_ARTIFACT');
  const bytes = await readFile(file);
  if (bytes.length > 15 * 1024 * 1024 || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) || digest(bytes) !== cv.sha256) throw hitlError('CV_ARTIFACT_INTEGRITY_FAILED');
  const digests = { job: digest({ id: job.job_id, canonical_url: job.canonical_url, application_url: job.application_url, content_hash: job.content_hash, description: job.description_text, company:job.company,title:job.title,location:job.location,country:job.country,work_mode:job.work_mode }), profile: activeProfileDigest(profile), cv: digest(bytes), cv_id: cv.cv_id, form: digest(formBinding(snapshot)) };
  const formUrl = new URL(snapshot.url);
  return { application, digests, binding_digest: digest(digests), summary: { company: job.company, title: job.title, canonical_url: job.canonical_url, application_url: job.application_url, cv_id: cv.cv_id, form_url: formUrl.origin+formUrl.pathname, field_count: snapshot.fields.length,cv_pdf_url:'/api/cvs/'+cv.cv_id+'/pdf',answers:(snapshot.fields??[]).filter(field=>field.visible&&!['hidden','password','file'].includes(field.type)&&!/token|otp|totp|authentication|secret/i.test(field.name??'')&&(field.type!=='radio'||field.checked)).map(field=>({question:field.label,type:field.type,answer:['checkbox','radio'].includes(field.type)?field.checked:field.value})),uploaded_files:(snapshot.uploaded_file_hashes??[]).map(file=>({filename:file.filename,sha256:file.sha256,evidence:file.evidence??'UNVERIFIED'})), observed_at: new Date().toISOString() } };
}
async function lockApplication(client, binding) {
  const app = (await client.query('SELECT * FROM applications WHERE application_id=$1 FOR UPDATE', [binding.application.application_id])).rows[0];
  if (!app || app.status !== 'READY_TO_SUBMIT' || app.cv_id !== binding.application.cv_id || app.candidate_profile_id !== binding.application.candidate_profile_id || app.last_state?.browser_session_id !== binding.application.last_state?.browser_session_id) throw hitlError('APPLICATION_CHANGED_DURING_REVIEW');
}
export async function prepareApplicationReview(repository, applicationId, profile, browser,{ttlMs=REVIEW_TTL_MS}={}) {
  if(!Number.isInteger(ttlMs)||ttlMs<REVIEW_TTL_MS||ttlMs>86400000)throw hitlError('INVALID_REVIEW_TTL');
  const binding = await buildBinding(repository, applicationId, profile, browser), client = await repository.pool.connect();
  try {
    await client.query('BEGIN'); await lockApplication(client, binding);
    if((await client.query("SELECT approval_id FROM application_review_gates WHERE application_id=$1 AND status='CONSUMED' LIMIT 1",[applicationId])).rows.length)throw hitlError('APPLICATION_REVIEW_ALREADY_CONSUMED');
    await client.query("UPDATE application_review_gates SET status='REVOKED',revoked_at=now() WHERE application_id=$1 AND status IN ('PREPARED','APPROVED')", [applicationId]);
    const gate = (await client.query(`INSERT INTO application_review_gates(approval_id,application_id,candidate_profile_id,campaign_id,digests,binding_digest,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [randomUUID(), applicationId, profile.profile_id, REVIEW_CAMPAIGN, binding.digests, binding.binding_digest, new Date(Date.now() + ttlMs)])).rows[0];
    await client.query('INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json) VALUES($1,$2,$3,$4,$5)',[randomUUID(),'application',applicationId,'USER_REVIEW_PREPARED',{approval_id:gate.approval_id,binding_digest:gate.binding_digest,source:'USER_DASHBOARD',review_only:true}]);
    await client.query('INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json) VALUES($1,$2,$3,$4,$5)',[randomUUID(),'application',applicationId,'APPLICATION_REVIEW_PACKET_SAVED',{approval_id:gate.approval_id,binding_digest:gate.binding_digest,summary:binding.summary}]);
    await client.query('COMMIT'); return { gate, summary: binding.summary, real_submit_enabled: false, review_only: true };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function approveApplicationReview(repository, applicationId, approvalId, expectedDigest, profile, browser,{source='USER_DASHBOARD'}={}) {
  if(!['USER_DASHBOARD','USER_TELEGRAM'].includes(source))throw hitlError('INVALID_CONFIRMATION_SOURCE');
  const binding = await buildBinding(repository, applicationId, profile, browser), client = await repository.pool.connect();
  try {
    await client.query('BEGIN'); await client.query("SELECT pg_advisory_xact_lock(hashtextextended('jobhunter:manual-review-v1',0))"); await lockApplication(client, binding);
    const gate = (await client.query('SELECT * FROM application_review_gates WHERE approval_id=$1 AND application_id=$2 FOR UPDATE', [approvalId, applicationId])).rows[0];
    if (!gate || gate.status !== 'PREPARED' || new Date(gate.expires_at).getTime() <= Date.now() || gate.candidate_profile_id !== profile.profile_id || gate.binding_digest !== expectedDigest || gate.binding_digest !== binding.binding_digest) throw hitlError('REVIEW_STALE_OR_ALREADY_APPROVED');
    const count = Number((await client.query("SELECT count(*) AS n FROM application_review_gates WHERE campaign_id=$1 AND status IN ('APPROVED','CONSUMED')", [REVIEW_CAMPAIGN])).rows[0].n);
    if (count >= REVIEW_APPLICATION_LIMIT) throw hitlError('TEN_APPLICATION_APPROVAL_LIMIT_REACHED');
    const saved = (await client.query("UPDATE application_review_gates SET status='APPROVED',approved_at=now() WHERE approval_id=$1 RETURNING *", [approvalId])).rows[0];
    await client.query('INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json) VALUES($1,$2,$3,$4,$5)', [randomUUID(), 'application', applicationId, 'USER_REVIEW_APPROVED', { approval_id: approvalId, binding_digest: expectedDigest, source, review_only: true }]);
    await client.query('COMMIT'); return { gate: saved, review_only: true, real_submit_enabled: false };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function revokeApplicationReview(repository, applicationId, approvalId, profile) {
  const client=await repository.pool.connect();
  try{
    await client.query('BEGIN');
    const row = (await client.query("UPDATE application_review_gates SET status='REVOKED',revoked_at=now() WHERE approval_id=$1 AND application_id=$2 AND candidate_profile_id=$3 AND status IN ('PREPARED','APPROVED') RETURNING approval_id,status", [approvalId, applicationId, profile.profile_id])).rows[0];
    if (!row) throw hitlError('REVIEW_NOT_REVOCABLE');
    await client.query('INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json) VALUES($1,$2,$3,$4,$5)',[randomUUID(),'application',applicationId,'USER_REVIEW_REVOKED',{approval_id:approvalId,source:'USER_DASHBOARD'}]);
    await client.query('COMMIT');return row;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
// Root must call this inside the application's existing mutex immediately before
// any future authorized Submit. It grants no browser permission and never clicks.
export async function consumeApplicationReview(repository, applicationId, approvalId, profile, browser, { assertProductionGate } = {}) {
  if (typeof assertProductionGate !== 'function' || await assertProductionGate() !== true) throw hitlError('PRODUCTION_EVIDENCE_GATE_REQUIRED');
  const binding = await buildBinding(repository, applicationId, profile, browser);
  const client=await repository.pool.connect();
  try{
    await client.query('BEGIN');await lockApplication(client,binding);
    const row = (await client.query(`UPDATE application_review_gates SET status='CONSUMED',consumed_at=now()
      WHERE approval_id=$1 AND application_id=$2 AND candidate_profile_id=$3 AND status='APPROVED' AND expires_at>now() AND binding_digest=$4 RETURNING approval_id`, [approvalId, applicationId, profile.profile_id, binding.binding_digest])).rows[0];
    if (!row) throw hitlError('APPROVED_REVIEW_REQUIRED_OR_STALE');
    await client.query('INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json) VALUES($1,$2,$3,$4,$5)',[randomUUID(),'application',applicationId,'USER_REVIEW_CONSUMED',{approval_id:approvalId,binding_digest:binding.binding_digest}]);
    await client.query('COMMIT');return row;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
