import {Repository} from '../services/core/repository.mjs';
import {load} from '../services/dashboard/queries.mjs';
import {ContinuousStore,cvWorkKey} from '../services/core/continuous-worker.mjs';
import {buildTailoredCv} from '../services/core/cv-v2.mjs';
import {registerIndependentCv} from '../services/core/cv-independent-qa.mjs';
import {hardwarePaused} from '../services/core/hardware-pause.mjs';
import {writeFile} from 'node:fs/promises';
const repository=new Repository(),store=new ContinuousStore(repository);
let release,ready=0,failed=0,reused=0;
const progress=state=>writeFile('data/runtime/cv-review-repair.json',JSON.stringify({state,pid:process.pid,ready,failed,reused,at:new Date().toISOString()}));
try{
 release=await store.acquireLane('cv-review-repair');if(!release)throw Error('CV_REPAIR_ALREADY_RUNNING');
 if(await hardwarePaused())throw Error('HARDWARE_PAUSED');
 if((await repository.pool.query('SELECT paused FROM runtime_control WHERE id=true')).rows[0]?.paused)throw Error('USER_PAUSED');
 const profile=await load('candidate_profile'),policy=await load('search_policy'),jobs=await store.cvCandidates(profile,policy);
 await progress('RUNNING');
 for(const job of jobs){
  if(await hardwarePaused())break;
  const key=cvWorkKey(job,job.analysis_json,profile);
  const work=(await repository.pool.query('SELECT status FROM continuous_work WHERE work_key=$1',[key])).rows[0];
  if(work?.status!=='DRAFT_PENDING_VISUAL')continue;
  try{
   let manifest=(await repository.pool.query('SELECT manifest_json FROM cv_drafts WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[job.job_id])).rows[0]?.manifest_json;
   let result=manifest?.qa?.pass?await registerIndependentCv({repository,manifest,profile}):null;
   if(result?.status==='REGISTERED')reused++;
   else{
    manifest=await buildTailoredCv({job,profile,analysis:job.analysis_json,repository,writerMode:'extractive',allowUnverifiedSource:true});
    result=manifest.qa.pass?await registerIndependentCv({repository,manifest,profile}):null;
   }
   if(result?.status==='REGISTERED'){
    ready++;await repository.pool.query("UPDATE continuous_work SET status='COMPLETED',outcome_code='REGISTERED',lease_until=NULL,updated_at=now() WHERE work_key=$1 AND status='DRAFT_PENDING_VISUAL'",[key]);
   }else{
    failed++;await repository.event('job',job.job_id,'CV_REPAIR_REQUIRES_REVIEW',{qa_reasons:result?.qa_reasons??[],error:manifest?.qa?.error?.message??null});
   }
  }catch(error){failed++;await repository.event('job',job.job_id,'CV_REPAIR_ERROR',{code:error.name});}
  await progress('RUNNING');
 }
 await progress('COMPLETED');
}finally{
 if(release)await release();await repository.pool.end();
}
