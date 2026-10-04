import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {canonicalAnalysisHash} from './evidence-hash.mjs';
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export async function verifyCurrentCvEvidence({cv,job,profile,analysis,artifactRoot='data/cv-v2'}){
 const reasons=[],manifest=cv?.manifest_json??{},qa=cv?.qa_json??{};
 const profileHash=hash(profile);
 if(!cv||cv.job_id!==job?.job_id)reasons.push('CV_JOB_MISMATCH');
 if(!qa.pass||!qa.claims?.pass||!qa.identity?.pass||!qa.pdf?.pass||!qa.pdf?.visual_review?.pass)reasons.push('COMPLETE_CV_QA_REQUIRED');
 if(manifest.application_eligible!==true||Object.hasOwn(manifest,'application_policy_blocker'))reasons.push('CV_NOT_EMPLOYER_READY');
 if(cv?.profile_version!==profileHash||manifest.profile_hash!==profileHash)reasons.push('CV_PROFILE_CHANGED');
 if(!job?.content_hash||manifest.job_content_hash!==job.content_hash)reasons.push('CV_SOURCE_CHANGED');
 if(!analysis||analysis.profile_hash!==profileHash||analysis.job_content_hash!==job?.content_hash||!['REVIEW','STRETCH','AUTO_APPLY'].includes(analysis.decision)||!analysis.requirements?.length||analysis.overall_fit==null||analysis.hard_blockers?.length)reasons.push('CURRENT_NON_BLOCKED_ANALYSIS_REQUIRED');
 if(!manifest.analysis_hash||manifest.analysis_hash!==canonicalAnalysisHash(analysis))reasons.push('CV_ANALYSIS_CHANGED');
 if(reasons.length)return {pass:false,reasons};
 try{
  const root=await realpath(artifactRoot),target=await realpath(cv.pdf_path),relative=path.relative(root,target);
  if(relative.startsWith('..')||path.isAbsolute(relative)||path.extname(target).toLowerCase()!=='.pdf')reasons.push('CV_ARTIFACT_OUTSIDE_APPROVED_ROOT');
  else{const bytes=await readFile(target);if(bytes.length>5*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-'||hash(bytes)!==cv.sha256)reasons.push('CV_BYTES_CHANGED');}
 }catch{reasons.push('CV_ARTIFACT_UNAVAILABLE');}
 return {pass:reasons.length===0,reasons,profile_hash:profileHash,job_content_hash:job.content_hash,cv_sha256:cv.sha256};
}
