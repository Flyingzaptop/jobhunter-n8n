import test from 'node:test';
import assert from 'node:assert/strict';
import {productionGateStatus} from '../services/core/production-gate.mjs';
import {RELEVANCE_VERSION,relevanceInputHash} from '../services/core/relevance-queue.mjs';
test('Production Gate requires full current queue coverage and current receipts; legacy PDF or arbitrary ATS evidence cannot pass',async()=>{
 const jobs=[1,2].map(n=>({job_id:`isolated-${n}`,title:'Regression-only role',canonical_url:`https://jobs.lever.co/isolated-regression/${n}`,description_text:'Regression only source',content_hash:`source-${n}`,availability_status:'OPEN'}));
 const profile={profile_id:'isolated-regression',onboarding:{legal_name:'Regression User',email:'regression@unit.invalid',phone:'+48123456789'}};
 let queue=[{job_id:jobs[0].job_id,status:'QUEUED',input_hash:relevanceInputHash(jobs[0]),relevance_version:RELEVANCE_VERSION}];
 const repository={listCanonicalJobs:async()=>jobs,pool:{query:async sql=>{
  if(sql.includes('FROM relevance_queue'))return {rows:queue};
  if(sql.includes('FROM fit_batch_receipts'))return {rows:[{job_id:jobs[0].job_id,fit_input_hash:'stale'}]};
  if(sql.includes('FROM cv_versions'))return {rows:[{cv_id:'legacy',job_id:jobs[0].job_id,qa_json:{pass:true},manifest_json:{}}]};
  if(sql.includes('FROM applications'))return {rows:[{application_id:'legacy-app',job_id:jobs[0].job_id,cv_id:'legacy',last_state:{final_review:{pass:true}}}]};
  return {rows:[]};
 }}};
 let result=await productionGateStatus({repository,profile});const check=id=>result.checks.find(c=>c.id===id);
 assert.equal(check('cheap_relevance_queue').pass,false);assert.equal(check('hundreds_actual_fit').evidence.unique_jobs,0);
 assert.equal(check('three_employer_ready_pdfs').evidence.unique_jobs,0);assert.deepEqual(check('three_ats_final_review_stop').evidence.adapters,[]);
 queue=jobs.map(j=>({job_id:j.job_id,status:'QUEUED',input_hash:relevanceInputHash(j),relevance_version:RELEVANCE_VERSION}));
 result=await productionGateStatus({repository,profile});assert.equal(check('cheap_relevance_queue').pass,true);
 jobs[1].description_text='Changed source';result=await productionGateStatus({repository,profile});assert.equal(check('cheap_relevance_queue').pass,false);assert.equal(result.real_submit_enabled,false);
});
