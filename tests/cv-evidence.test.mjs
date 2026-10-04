import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {verifyCurrentCvEvidence} from '../services/core/cv-evidence.mjs';
import {canonicalAnalysisHash} from '../services/core/evidence-hash.mjs';
const hash=value=>createHash('sha256').update(Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
test('review evidence rejects stale profile, source, analysis, PDF bytes and policy-blocked CVs',async t=>{
 const root=path.resolve('data');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'cv-evidence-regression-'));
 t.after(async()=>{if(!directory.startsWith(root+path.sep))throw new Error('Regression cleanup outside workspace data');await rm(directory,{recursive:true,force:true});});
 const profile={profile_id:'isolated-regression-profile'},job={job_id:'isolated-job',content_hash:'known-source'};
 const analysis={profile_hash:hash(profile),job_content_hash:job.content_hash,decision:'REVIEW',requirements:[{match:'PARTIAL'}],overall_fit:65,hard_blockers:[]};
 const bytes=Buffer.from('%PDF-1.4\nISOLATED_REGRESSION_ONLY');const pdfPath=path.join(directory,'cv.pdf');await writeFile(pdfPath,bytes);
 const cv={job_id:job.job_id,profile_version:hash(profile),pdf_path:pdfPath,sha256:hash(bytes),qa_json:{pass:true,claims:{pass:true},identity:{pass:true},pdf:{pass:true,visual_review:{pass:true}}},manifest_json:{profile_hash:hash(profile),job_content_hash:job.content_hash,analysis_hash:canonicalAnalysisHash(analysis),application_eligible:true}};
 const input={cv,job,profile,analysis,artifactRoot:directory};assert.equal((await verifyCurrentCvEvidence(input)).pass,true);
 for(const changed of [{...input,profile:{...profile,new_fact:true}},{...input,job:{...job,content_hash:'changed'}},{...input,analysis:{...analysis,overall_fit:90}},{...input,cv:{...cv,manifest_json:{...cv.manifest_json,application_policy_blocker:'HUMAN_AUTHORED_ONLY'}}}])assert.equal((await verifyCurrentCvEvidence(changed)).pass,false);
 await writeFile(pdfPath,Buffer.from('%PDF-1.4\nCHANGED'));assert.ok((await verifyCurrentCvEvidence(input)).reasons.includes('CV_BYTES_CHANGED'));
});
