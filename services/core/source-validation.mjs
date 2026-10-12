import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fastWorkFormat} from './fit-fast.mjs';
import {eligibleSourceAnalysis} from './continuous-worker.mjs';
import {reverifyMarketJob} from './discovery-v2.mjs';
import {verifyCurrentCvEvidence} from './cv-evidence.mjs';
import {currentPreparationPolicy} from './preparation-policy.mjs';
import {canonicalAnalysisHash} from './evidence-hash.mjs';
import {activeProfileDigest} from '../dashboard/review-gates.mjs';
import {workFormatAnalysis} from './fit.mjs';
import {SharedSnapshot} from './worker-pacing.mjs';

const caches=new WeakMap();
export function needsSourceVerification(row,profile,policy){
 const location=workFormatAnalysis({job:row,profile,policy,workFormat:row.analysis_json?.work_format}).location_policy_status;
 return eligibleSourceAnalysis(row,row.analysis_json,profile,policy)&&location!=='INCOMPATIBLE'&&
  (row.cv_manifest?.source_verification_required===true||location==='UNVERIFIED')&&(!row.cv_id||row.cv_manifest.analysis_hash===canonicalAnalysisHash(row.analysis_json));
}
export async function validationCandidates(repository,profile,policy){
 let cache=caches.get(repository);if(!cache){cache=new SharedSnapshot(60000);caches.set(repository,cache);}
 const rows=await cache.get(activeProfileDigest({profile,policy}),async()=>{
  const result=await repository.pool.query(`SELECT j.*,a.analysis_json,c.cv_id,c.manifest_json cv_manifest FROM jobs j JOIN LATERAL(SELECT analysis_json FROM job_analysis WHERE job_id=j.job_id ORDER BY created_at DESC LIMIT 1)a ON true LEFT JOIN LATERAL(SELECT cv_id,manifest_json FROM cv_versions WHERE job_id=j.job_id AND profile_version=$1 AND template_version='cv-factory-v2.5-extractive-fast' AND qa_json->>'pass'='true' AND manifest_json->>'job_content_hash'=j.content_hash ORDER BY created_at DESC LIMIT 1)c ON true WHERE j.availability_status<>'CLOSED' AND (c.cv_id IS NOT NULL OR a.analysis_json->>'location_policy_status'='UNVERIFIED' OR a.analysis_json->>'fit_complete'='false')`,[activeProfileDigest(profile)]);
  return result.rows.map(row=>row.cv_id&&row.cv_manifest.analysis_hash!==canonicalAnalysisHash(row.analysis_json)?{...row,cv_id:null,cv_manifest:null}:row).filter(row=>needsSourceVerification(row,profile,policy)).sort((a,b)=>Number(b.analysis_json.overall_fit)-Number(a.analysis_json.overall_fit));
 });
 if(!rows.length)return rows;
 const keys=rows.map(row=>`source:v2:${row.job_id}:${row.content_hash}`);
 const unavailable=new Set((await repository.pool.query("SELECT work_key FROM continuous_work WHERE work_key=ANY($1::text[]) AND NOT(status='RETRY' AND next_retry_at<=now() OR status='RUNNING' AND lease_until<now())",[keys])).rows.map(r=>r.work_key));
 return rows.filter((row,i)=>!unavailable.has(keys[i]));
}
export async function validateSourceForCv({repository,job,profile,policy}){
 const verified=await reverifyMarketJob({repository,job});
 if(verified.status!=='OPEN')return {blocked_reason:verified.reason??'SOURCE_NOT_OPEN'};
 const refreshed=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[job.job_id])).rows[0];
 const regions=refreshed.metadata?.validated_applicant_locations??[];if(regions.length&&!regions.some(r=>/^(?:poland|polska|pl|europe|european union|eu|eea|emea|worldwide|global|anywhere)$/i.test(r.trim())))return {blocked_reason:'SOURCE_APPLICANT_LOCATION_UNVERIFIED_FOR_POLAND'};
 const freshLocation=workFormatAnalysis({job:refreshed,profile,policy,workFormat:fastWorkFormat(refreshed)}).location_policy_status;
 if(refreshed.content_hash===job.content_hash&&(job.analysis_json.fit_complete===false||job.analysis_json.location_policy_status==='UNVERIFIED')&&freshLocation!=='UNVERIFIED'){
  refreshed.content_hash=createHash('sha256').update(JSON.stringify([refreshed.content_hash,refreshed.work_mode,refreshed.location,refreshed.metadata?.validated_applicant_locations??[],freshLocation,'fit-location-v1'])).digest('hex');
  await repository.pool.query('UPDATE jobs SET content_hash=$2 WHERE job_id=$1',[job.job_id,refreshed.content_hash]);
 }
 if(refreshed.content_hash!==job.content_hash){await repository.pool.query("UPDATE relevance_queue SET status='QUEUED',next_retry_at=NULL,active_fit_hash=NULL WHERE job_id=$1",[job.job_id]);return {blocked_reason:'SOURCE_CHANGED_REQUIRES_FIT'};}
 if(!job.cv_id)return {blocked_reason:'FIT_LOCATION_EVIDENCE_REQUIRED_BEFORE_CV'};
 const cv=(await repository.pool.query('SELECT * FROM cv_versions WHERE cv_id=$1',[job.cv_id])).rows[0],manifest=structuredClone(cv.manifest_json);
 if(!currentPreparationPolicy({job:refreshed,profile,policy,analysis:job.analysis_json,cv}).pass)return {blocked_reason:'SOURCE_LOCATION_POLICY_UNVERIFIED'};
 manifest.application_eligible=true;manifest.source_verification_required=false;manifest.source_verified_at=new Date().toISOString();
 const promoted={...cv,manifest_json:manifest};
 if(!(await verifyCurrentCvEvidence({cv:promoted,job:refreshed,profile,analysis:job.analysis_json})).pass)return {blocked_reason:'SOURCE_CV_BINDING_UNVERIFIED'};
 await repository.pool.query('UPDATE cv_versions SET manifest_json=$2 WHERE cv_id=$1',[cv.cv_id,manifest]);
 await writeFile(manifest.manifest_path,JSON.stringify(manifest,null,2));
 await repository.event('cv',cv.cv_id,'SOURCE_VERIFIED_CV_APPLICATION_ENABLED',{job_id:job.job_id,method:verified.method??verified.reason});return {status:'VERIFIED'};
}
