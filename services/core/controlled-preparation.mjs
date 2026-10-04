import {createHash,randomUUID} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {cvIdentityQa} from './cv-v2.mjs';
import {reverifyMarketJob} from './discovery-v2.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
export async function createControlledPreparation({repository,jobId,cvId,profile,artifactRoot='data/cv-v2'}){
 if(process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT==='true')throw new Error('CONTROLLED_PREPARATION_REQUIRES_DRY_RUN');
 if(!uuid(jobId)||!uuid(cvId)||!profile.profile_id||!cvIdentityQa(profile).pass)throw new Error('VERIFIED_IDENTITY_AND_IDS_REQUIRED');
 const job=(await repository.listCanonicalJobs()).find(j=>j.job_id===jobId);
 if(!job)throw new Error('JOB_NOT_FOUND');
 const analysis=(await repository.pool.query('SELECT analysis_json,decision FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[jobId])).rows[0];
 if(!analysis||!['REVIEW','STRETCH','AUTO_APPLY'].includes(analysis.decision))throw new Error('NON_REJECTED_ACTUAL_ANALYSIS_REQUIRED');
 if(analysis.analysis_json?.overall_fit==null||!analysis.analysis_json?.requirements?.length||analysis.analysis_json?.hard_blockers?.length)throw new Error('INFORMATION_COMPLETE_NON_BLOCKED_ANALYSIS_REQUIRED');
 const cv=(await repository.pool.query('SELECT * FROM cv_versions WHERE cv_id=$1 AND job_id=$2',[cvId,jobId])).rows[0];
 if(!cv?.qa_json?.pass||cv.manifest_json?.application_eligible!==true||cv.manifest_json?.application_policy_blocker)throw new Error('EMPLOYER_READY_VERIFIED_CV_REQUIRED');
 const profileHash=digest(JSON.stringify(profile));
 if(cv.profile_version!==profileHash)throw new Error('CV_PROFILE_CHANGED_REGENERATE_REQUIRED');
 const root=await realpath(artifactRoot),file=await realpath(cv.pdf_path),relative=path.relative(root,file);
 if(relative.startsWith('..')||path.isAbsolute(relative)||path.extname(file).toLowerCase()!=='.pdf')throw new Error('CV_ARTIFACT_OUTSIDE_APPROVED_ROOT');
 const bytes=await readFile(file);if(digest(bytes)!==cv.sha256||bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('CV_BYTES_CHANGED');
 const verified=await reverifyMarketJob({job,repository});
 if(verified.status!=='OPEN')throw new Error('CURRENT_OFFICIAL_POSTING_NOT_OPEN');
 const state={preparation_only:true,control_mode:'PER_APPLICATION_CONFIRMATION',readiness_gate_pass:false,
  profile_hash:profileHash,cv_sha256:cv.sha256,job_content_hash:verified.job?.content_hash??job.content_hash,
  source_decision:analysis.decision,authorization_basis:'USER_REQUESTED_PRODUCTION_GATE_REHEARSAL'};
 const row=(await repository.pool.query(`INSERT INTO applications(application_id,candidate_profile_id,job_id,cv_id,status,dry_run,last_state) VALUES($1,$2,$3,$4,'QUEUED',true,$5) ON CONFLICT(candidate_profile_id,job_id) DO UPDATE SET updated_at=applications.updated_at RETURNING *`,[randomUUID(),profile.profile_id,jobId,cvId,state])).rows[0];
 if(row.cv_id!==cvId)throw new Error('EXISTING_APPLICATION_USES_DIFFERENT_CV');
 await repository.event('application',row.application_id,'CONTROLLED_PREPARATION_AUTHORIZED',{job_id:jobId,cv_id:cvId,source_decision:analysis.decision,dry_run:true,real_submit_enabled:false});
 return row;
}
