// Temporary CPU-only drain while an already-running legacy CV finishes.
import {Repository} from '../services/core/repository.mjs';
import {load} from '../services/dashboard/queries.mjs';
import {ContinuousStore,cvWorkKey} from '../services/core/continuous-worker.mjs';
import {buildTailoredCv} from '../services/core/cv-v2.mjs';
import {registerIndependentCv} from '../services/core/cv-independent-qa.mjs';
import {hardwarePaused} from '../services/core/hardware-pause.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const repository=new Repository(),store=new ContinuousStore(repository);
let ready=0,review=0,release;
async function authorized(){
 if(await hardwarePaused())return false;
 const upgrade=JSON.parse(await readFile('data/runtime/cv-upgrade-status.json','utf8'));
 if(upgrade.state!=='WAITING_FOR_CURRENT_CV')return false;
 try{process.kill(upgrade.pid,0);return true;}catch{return false;}
}
try{
 release=await store.acquireLane('cv-cpu-upgrade');if(!release)throw Error('DRAIN_ALREADY_RUNNING');
 while(await authorized()){
  const profile=await load('candidate_profile'),policy=await load('search_policy');
  if((await store.phaseBarrier(profile,policy))?.phase!=='CV'||await store.hasPendingFit(profile,policy))break;
  const jobs=(await store.runnableCvCandidates(profile,policy)).slice(0,100);if(!jobs.length)break;
  let claimed=0;
  for(const job of jobs){
   if(!await authorized())break;
   const key=cvWorkKey(job,job.analysis_json,profile);if(!await store.claim(key,'cv',job.job_id))continue;claimed++;
   try{
    const manifest=await buildTailoredCv({job,profile,analysis:job.analysis_json,repository,writerMode:'extractive',allowUnverifiedSource:true});
    const result=manifest.qa.pass?await registerIndependentCv({repository,manifest,profile}):null;
    if(result?.status==='REGISTERED'){ready++;await store.finish(key,'COMPLETED','REGISTERED');}
    else{review++;await store.finish(key,'DRAFT_PENDING_VISUAL','EXTRACTIVE_CV_REQUIRES_REVIEW');}
   }catch{review++;await store.finish(key,'DRAFT_PENDING_VISUAL','CV_RECOVERY_EXCEPTION');}
   await writeFile('data/runtime/cv-cpu-progress.json',JSON.stringify({pid:process.pid,ready,review,at:new Date().toISOString()}));
  }
  if(!claimed)break;
 }
}finally{if(release)await release();await repository.pool.end();}
