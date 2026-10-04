import test from 'node:test';
import assert from 'node:assert/strict';
import {createControlledPreparation} from '../services/core/controlled-preparation.mjs';
test('controlled rehearsal cannot use rejected, incomplete or policy-blocked CVs and never changes submit configuration',async()=>{
 const before={dry:process.env.DRY_RUN,real:process.env.ALLOW_REAL_SUBMIT};process.env.DRY_RUN='true';process.env.ALLOW_REAL_SUBMIT='false';
 const jobId='7458d4e9-da2e-47bd-98cb-adfda43d42b2',cvId='7458d4e9-da2e-47bd-98cb-adfda43d42b3';
 const profile={profile_id:'regression-candidate',onboarding:{legal_name:'Regression Person',email:'regression@unit.invalid',phone:'+48123456789'}};
 let decision='REJECT',analysis={overall_fit:80,requirements:[{}]},cv={qa_json:{pass:true},manifest_json:{application_eligible:false,application_policy_blocker:'HUMAN_AUTHORED_ONLY'}};
 const repo={listCanonicalJobs:async()=>[{job_id:jobId}],pool:{query:async sql=>({rows:sql.includes('job_analysis')?[{decision,analysis_json:analysis}]:sql.includes('cv_versions')?[cv]:[]})}};
 try{
  await assert.rejects(createControlledPreparation({repository:repo,jobId,cvId,profile}),/NON_REJECTED_ACTUAL_ANALYSIS_REQUIRED/);
  decision='REVIEW';analysis={overall_fit:null,requirements:[]};await assert.rejects(createControlledPreparation({repository:repo,jobId,cvId,profile}),/INFORMATION_COMPLETE/);
  analysis={overall_fit:80,requirements:[{}]};await assert.rejects(createControlledPreparation({repository:repo,jobId,cvId,profile}),/EMPLOYER_READY_VERIFIED_CV/);
  assert.equal(process.env.ALLOW_REAL_SUBMIT,'false');
 }finally{for(const [key,value] of [['DRY_RUN',before.dry],['ALLOW_REAL_SUBMIT',before.real]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
