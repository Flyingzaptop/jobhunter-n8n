import {createHash,randomUUID} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {cvIdentityQa} from './cv-v2.mjs';
import {reverifyMarketJob} from './discovery-v2.mjs';
import {verifyCurrentCvEvidence} from './cv-evidence.mjs';
import {currentPreparationPolicy} from './preparation-policy.mjs';
import YAML from 'yaml';

const digest=value=>createHash('sha256').update(value).digest('hex');
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
export function refreshedDraftState(current,{profileHash,cv,job,freshForm}){
 const state={...current.last_state,profile_hash:profileHash,cv_sha256:cv.sha256,job_content_hash:job.content_hash,final_review:null,model_review:null,full_fields_checked:false,ready_stop:false};
 if(freshForm)Object.assign(state,{browser_session_id:null,confirmed_fields:{},form_answers:[],pending_question:null,prose_pending_question:null,application_documents:{},fresh_form_reason:'PROFILE_CHANGED'});
 return state;
}
export async function refreshPreparationCv({repository,applicationId,cvId,profile,policy}){
 const app=(await repository.pool.query('SELECT * FROM applications WHERE application_id=$1 AND candidate_profile_id=$2',[applicationId,profile.profile_id])).rows[0];
 if(!app)throw Error('APPLICATION_NOT_FOUND');const profileHash=digest(JSON.stringify(profile));const freshForm=Boolean(app.last_state?.profile_hash&&app.last_state.profile_hash!==profileHash);if(app.cv_id===cvId&&!freshForm)return app;
 if(!app.dry_run||!['QUEUED','OPENING','FILLING'].includes(app.status)||app.submitted_at||app.confirmation_id)throw Error('APPLICATION_CV_REFRESH_NOT_ALLOWED');
 const job=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[app.job_id])).rows[0],cv=(await repository.pool.query('SELECT * FROM cv_versions WHERE cv_id=$1 AND job_id=$2',[cvId,app.job_id])).rows[0];
 const analysis=(await repository.pool.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[app.job_id])).rows[0]?.analysis_json;
 if(analysis?.policy_hash!==digest(JSON.stringify(policy))||!currentPreparationPolicy({job,profile,policy,analysis,cv}).pass||!(await verifyCurrentCvEvidence({cv,job,profile,analysis})).pass)throw Error('CURRENT_CV_REFRESH_EVIDENCE_REQUIRED');

 const client=await repository.pool.connect();try{await client.query('BEGIN');
  if(!(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked',[applicationId])).rows[0].locked){await client.query('ROLLBACK');return {blocked_reason:'APPLICATION_BUSY'};}
  const current=(await client.query('SELECT * FROM applications WHERE application_id=$1 FOR UPDATE',[applicationId])).rows[0];
  if(current.cv_id!==app.cv_id||!['QUEUED','OPENING','FILLING'].includes(current.status)||current.submitted_at||current.confirmation_id)throw Error('APPLICATION_CHANGED_DURING_CV_REFRESH');
  if((await client.query('SELECT 1 FROM confirmed_submit_commands WHERE application_id=$1 LIMIT 1',[applicationId])).rowCount)throw Error('PRIOR_SUBMIT_COMMAND_REQUIRES_RECONCILIATION');
  await client.query("UPDATE application_review_gates SET status='REVOKED',revoked_at=now() WHERE application_id=$1 AND status IN('PREPARED','APPROVED')",[applicationId]);
  const state=refreshedDraftState(current,{profileHash,cv,job,freshForm});
  const row=(await client.query('UPDATE applications SET cv_id=$2,last_state=$3::jsonb,status=$4,updated_at=now() WHERE application_id=$1 RETURNING *',[applicationId,cvId,state,freshForm?'OPENING':current.status])).rows[0];
  if(freshForm)await client.query("UPDATE application_questions SET closed_at=now(),closed_reason='PROFILE_CHANGED_FRESH_FORM' WHERE application_id=$1 AND closed_at IS NULL",[applicationId]);
  await client.query("INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json)VALUES($1,'application',$2,'PREPARATION_CV_REFRESHED',$3)",[randomUUID(),applicationId,{previous_cv_id:app.cv_id,cv_id:cvId,source:'CURRENT_EVALUATED_TAILORED_CV',requires_new_submit_confirmation:true}]);
  await client.query('COMMIT');return row;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function createControlledPreparation({repository,jobId,cvId,profile,policy,artifactRoot='data/cv-v2'}){
 if(process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT==='true')throw new Error('CONTROLLED_PREPARATION_REQUIRES_DRY_RUN');
 if(!uuid(jobId)||!uuid(cvId)||!profile.profile_id||!cvIdentityQa(profile).pass)throw new Error('VERIFIED_IDENTITY_AND_IDS_REQUIRED');
 const jobRow=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[jobId])).rows[0];
 const job=jobRow?{...jobRow.metadata,...jobRow}:null;
 if(!job)throw new Error('JOB_NOT_FOUND');
 const analysis=(await repository.pool.query('SELECT analysis_json,decision FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[jobId])).rows[0];
 if(!analysis||!['REVIEW','STRETCH','AUTO_APPLY'].includes(analysis.decision))throw new Error('NON_REJECTED_ACTUAL_ANALYSIS_REQUIRED');
 if(analysis.analysis_json?.overall_fit==null||!analysis.analysis_json?.requirements?.length||analysis.analysis_json?.hard_blockers?.length)throw new Error('INFORMATION_COMPLETE_NON_BLOCKED_ANALYSIS_REQUIRED');
 const cv=(await repository.pool.query('SELECT * FROM cv_versions WHERE cv_id=$1 AND job_id=$2',[cvId,jobId])).rows[0];
 if(!cv?.qa_json?.pass||cv.manifest_json?.application_eligible!==true||cv.manifest_json?.application_policy_blocker)throw new Error('EMPLOYER_READY_VERIFIED_CV_REQUIRED');
 const profileHash=digest(JSON.stringify(profile));
 if(cv.profile_version!==profileHash)throw new Error('CV_PROFILE_CHANGED_REGENERATE_REQUIRED');
 const currentPolicy=policy??YAML.parse(await readFile('config/search_policy.yaml','utf8'));
 const preparation=currentPreparationPolicy({job,profile,policy:currentPolicy,analysis:analysis.analysis_json,cv});
 if(!preparation.pass)throw new Error(preparation.reason);
 if(analysis.analysis_json?.policy_hash!==digest(JSON.stringify(currentPolicy)))throw new Error('ANALYSIS_POLICY_CHANGED_REEVALUATE_REQUIRED');
 const root=await realpath(artifactRoot),file=await realpath(cv.pdf_path),relative=path.relative(root,file);
 if(relative.startsWith('..')||path.isAbsolute(relative)||path.extname(file).toLowerCase()!=='.pdf')throw new Error('CV_ARTIFACT_OUTSIDE_APPROVED_ROOT');
 const bytes=await readFile(file);if(digest(bytes)!==cv.sha256||bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('CV_BYTES_CHANGED');
 const verified=await reverifyMarketJob({job,repository});
 if(verified.status!=='OPEN')throw new Error('CURRENT_OFFICIAL_POSTING_NOT_OPEN');
 const refreshedJob=verified.job??(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[jobId])).rows[0];
 const refreshedPolicy=currentPreparationPolicy({job:refreshedJob,profile,policy:currentPolicy,analysis:analysis.analysis_json,cv});
 if(!refreshedPolicy.pass)throw new Error(refreshedPolicy.reason);
 const current=await verifyCurrentCvEvidence({cv,job:refreshedJob,profile,analysis:analysis.analysis_json,artifactRoot});
 if(!current.pass)throw new Error(`PREPARATION_EVIDENCE_STALE:${current.reasons.join(',')}`);
 const state={preparation_only:true,control_mode:'PER_APPLICATION_CONFIRMATION',readiness_gate_pass:false,
  profile_hash:profileHash,cv_sha256:cv.sha256,job_content_hash:verified.job?.content_hash??job.content_hash,
  source_decision:analysis.decision,authorization_basis:'USER_REQUESTED_PRODUCTION_GATE_REHEARSAL'};
 const row=(await repository.pool.query(`INSERT INTO applications(application_id,candidate_profile_id,job_id,cv_id,status,dry_run,last_state) VALUES($1,$2,$3,$4,'QUEUED',true,$5) ON CONFLICT(candidate_profile_id,job_id) DO UPDATE SET updated_at=applications.updated_at RETURNING *`,[randomUUID(),profile.profile_id,jobId,cvId,state])).rows[0];
 if(row.cv_id!==cvId)throw new Error('EXISTING_APPLICATION_USES_DIFFERENT_CV');
 await repository.event('application',row.application_id,'CONTROLLED_PREPARATION_AUTHORIZED',{job_id:jobId,cv_id:cvId,source_decision:analysis.decision,dry_run:true,real_submit_enabled:false});
 return row;
}
