import {readFile,writeFile} from 'node:fs/promises';
import {eligibleAnalysis} from './continuous-worker.mjs';
import {reverifyMarketJob} from './discovery-v2.mjs';
import {verifyCurrentCvEvidence} from './cv-evidence.mjs';
import {currentPreparationPolicy} from './preparation-policy.mjs';
import {canonicalAnalysisHash} from './evidence-hash.mjs';
import {activeProfileDigest} from '../dashboard/review-gates.mjs';

const caches=new WeakMap();
export async function validationCandidates(repository,profile,policy){
 const old=caches.get(repository);if(old&&Date.now()-old.at<5000)return old.promise;
 const promise=repository.pool.query(`SELECT DISTINCT ON(j.job_id) j.*,a.analysis_json,c.cv_id,c.manifest_json cv_manifest FROM jobs j JOIN cv_versions c USING(job_id) JOIN LATERAL(SELECT analysis_json FROM job_analysis WHERE job_id=j.job_id ORDER BY created_at DESC LIMIT 1)a ON true WHERE j.availability_status<>'CLOSED' AND c.profile_version=$1 AND c.template_version='cv-factory-v2.5-extractive-fast' AND c.qa_json->>'pass'='true' AND c.manifest_json->>'source_verification_required'='true' AND c.manifest_json->>'job_content_hash'=j.content_hash ORDER BY j.job_id,c.created_at DESC`,[activeProfileDigest(profile)]).then(result=>result.rows.filter(row=>currentPreparationPolicy({job:{...row,availability_status:'OPEN'},profile,policy,analysis:row.analysis_json}).pass&&eligibleAnalysis({...row,availability_status:'OPEN'},row.analysis_json,profile,policy)&&row.cv_manifest.analysis_hash===canonicalAnalysisHash(row.analysis_json)).sort((a,b)=>Number(b.analysis_json.overall_fit)-Number(a.analysis_json.overall_fit)));
 caches.set(repository,{at:Date.now(),promise});return promise;
}
export async function validateSourceForCv({repository,job,profile,policy}){
 const verified=await reverifyMarketJob({repository,job});
 if(verified.status!=='OPEN')return {blocked_reason:verified.reason??'SOURCE_NOT_OPEN'};
 const refreshed=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[job.job_id])).rows[0];
 const regions=refreshed.metadata?.validated_applicant_locations??[];if(regions.length&&!regions.some(r=>/^(?:poland|polska|pl|europe|european union|eu|eea|emea|worldwide|global|anywhere)$/i.test(r.trim())))return {blocked_reason:'SOURCE_APPLICANT_LOCATION_UNVERIFIED_FOR_POLAND'};
 if(refreshed.content_hash!==job.content_hash){await repository.pool.query("UPDATE relevance_queue SET status='QUEUED',next_retry_at=NULL,active_fit_hash=NULL WHERE job_id=$1",[job.job_id]);return {blocked_reason:'SOURCE_CHANGED_REQUIRES_FIT'};}
 const cv=(await repository.pool.query('SELECT * FROM cv_versions WHERE cv_id=$1',[job.cv_id])).rows[0],manifest=structuredClone(cv.manifest_json);
 if(!currentPreparationPolicy({job:refreshed,profile,policy,analysis:job.analysis_json,cv}).pass)return {blocked_reason:'SOURCE_LOCATION_POLICY_UNVERIFIED'};
 manifest.application_eligible=true;manifest.source_verification_required=false;manifest.source_verified_at=new Date().toISOString();
 const promoted={...cv,manifest_json:manifest};
 if(!(await verifyCurrentCvEvidence({cv:promoted,job:refreshed,profile,analysis:job.analysis_json})).pass)return {blocked_reason:'SOURCE_CV_BINDING_UNVERIFIED'};
 await repository.pool.query('UPDATE cv_versions SET manifest_json=$2 WHERE cv_id=$1',[cv.cv_id,manifest]);
 await writeFile(manifest.manifest_path,JSON.stringify(manifest,null,2));
 await repository.event('cv',cv.cv_id,'SOURCE_VERIFIED_CV_APPLICATION_ENABLED',{job_id:job.job_id,method:verified.method??verified.reason});return {status:'VERIFIED'};
}
