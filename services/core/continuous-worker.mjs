import {randomUUID,createHash} from 'node:crypto';
import {canonicalAnalysisHash} from './evidence-hash.mjs';
import {CV_V2_VERSION} from './cv-v2.mjs';
import {workFormatAnalysis,PROMPT_VERSION} from './fit.mjs';

const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const safeCode=value=>/^[A-Z][A-Z0-9_]{0,79}$/.test(value??'')?value:'OPERATION_FAILED';
const waiting=new Set(['NEEDS_USER','CAPTCHA_WAIT','MANUAL_TAKEOVER','MANUAL','READY_STOP','READY_TO_SUBMIT']);
export function cvWorkKey(job,analysis,profile,templateVersion=CV_V2_VERSION){return 'cv:'+digest([templateVersion,job.job_id,job.content_hash,canonicalAnalysisHash(analysis),digest(profile)]);}
function currentNonBlockedAnalysis(job,analysis,profile,policy={}){return job.availability_status==='OPEN'
 && analysis?.prompt_version===PROMPT_VERSION
 && ['REVIEW','STRETCH','AUTO_APPLY'].includes(analysis?.decision) && Number(analysis.overall_fit)>=45
 && analysis.profile_hash===digest(profile)&&analysis.job_content_hash===job.content_hash
 && analysis.policy_hash===digest(policy)&&!policy.excluded_job_ids?.includes(job.job_id)
 && !(policy.excluded_companies??[]).some(company=>String(company).toLowerCase()===String(job.company).toLowerCase())
 && !(policy.excluded_countries??[]).some(country=>String(country).toLowerCase()===String(job.country).toLowerCase())
 && Array.isArray(analysis.requirements)&&analysis.requirements.length>0
 && Array.isArray(analysis.hard_blockers)&&analysis.hard_blockers.length===0;}
export function eligibleAnalysis(job,analysis,profile,policy={}){return currentNonBlockedAnalysis(job,analysis,profile,policy)
 && workFormatAnalysis({job,profile,policy,workFormat:analysis.work_format}).location_policy_status==='COMPATIBLE';}
export function eligibleCvAnalysis(job,analysis,profile,policy={}){
 if(!currentNonBlockedAnalysis(job,analysis,profile,policy))return false;
 const location=workFormatAnalysis({job,profile,policy,workFormat:analysis.work_format});
 return location.location_policy_status==='COMPATIBLE'||location.location_policy_status==='UNVERIFIED'
  && analysis.employment_eligibility?.work_from_poland_allowed===true;
}
export function currentTailoredCv(manifest,job,analysis){return manifest?.template_version===CV_V2_VERSION&&manifest?.qa?.tailoring?.pass===true
 && manifest.job_content_hash===job.content_hash&&manifest.analysis_hash===canonicalAnalysisHash(analysis);}

export class ContinuousStore {
 constructor(repository,{ownerId=randomUUID(),leaseMs=7200000}={}){this.repository=repository;this.ownerId=ownerId;this.leaseMs=leaseMs;}
 async loadModelSchedule(){
  const row=(await this.repository.pool.query("SELECT outcome_code FROM continuous_work WHERE work_key='model:scheduler:v1'")).rows[0];
  try{const state=JSON.parse(row?.outcome_code??'null');if(['fit','cv'].includes(state?.nextModel)&&typeof state.proseTurn==='boolean')return state;}catch{}
  return {nextModel:'fit',proseTurn:false};
 }
 async saveModelSchedule(state){
  await this.repository.pool.query(`INSERT INTO continuous_work(work_key,lane,status,outcome_code)
   VALUES('model:scheduler:v1','scheduler','COMPLETED',$1) ON CONFLICT(work_key)
   DO UPDATE SET outcome_code=EXCLUDED.outcome_code,updated_at=now()`,[JSON.stringify(state)]);
 }
 async acquireLane(lane){const client=await this.repository.pool.connect();
  try{const {rows}=await client.query('SELECT pg_try_advisory_lock(hashtext($1)) locked',['jobhunter.continuous.'+lane]);
   if(!rows[0].locked){client.release();return null;}
   return async()=>{try{await client.query('SELECT pg_advisory_unlock(hashtext($1))',['jobhunter.continuous.'+lane]);}finally{client.release();}};
  }catch(error){client.release();throw error;}}
 async claim(key,lane,entityId){const {rows}=await this.repository.pool.query(`INSERT INTO continuous_work(work_key,lane,entity_id,status,owner_id,lease_until)
  VALUES($1,$2,$3,'RUNNING',$4,now()+$5*interval '1 millisecond') ON CONFLICT(work_key) DO UPDATE SET
  status='RUNNING',owner_id=EXCLUDED.owner_id,lease_until=EXCLUDED.lease_until,attempt_count=continuous_work.attempt_count+1,updated_at=now()
  WHERE (continuous_work.status='RETRY' AND continuous_work.next_retry_at<=now())
  OR (continuous_work.status='RUNNING' AND continuous_work.lease_until<now()) RETURNING work_key`,[key,lane,entityId,this.ownerId,this.leaseMs]);return rows.length>0;}
 async finish(key,status,code){await this.repository.pool.query(`UPDATE continuous_work SET status=$3,outcome_code=$4,lease_until=NULL,
  next_retry_at=CASE WHEN $3='RETRY' THEN now()+interval '5 minutes' ELSE NULL END,updated_at=now() WHERE work_key=$1 AND owner_id=$2`,[key,this.ownerId,status,safeCode(code)]);}
 async heartbeat(key){await this.repository.pool.query("UPDATE continuous_work SET lease_until=now()+$3*interval '1 millisecond',updated_at=now() WHERE work_key=$1 AND owner_id=$2 AND status='RUNNING'",[key,this.ownerId,this.leaseMs]);}
 async status(lane,state,code=null){await this.repository.pool.query(`INSERT INTO continuous_worker_status(lane,owner_id,state,outcome_code,ticks)
  VALUES($1,$2,$3,$4,1) ON CONFLICT(lane) DO UPDATE SET owner_id=EXCLUDED.owner_id,state=EXCLUDED.state,outcome_code=EXCLUDED.outcome_code,
  ticks=continuous_worker_status.ticks+1,updated_at=now()`,[lane,this.ownerId,state,code&&safeCode(code)]);}
 async paused(){return (await this.repository.pool.query('SELECT paused FROM runtime_control WHERE id=true')).rows[0]?.paused===true;}
 async cvCandidates(profile,policy){const rows=(await this.repository.pool.query(`SELECT j.*,a.analysis_json,
  (SELECT coalesce(jsonb_agg(c.manifest_json),'[]'::jsonb) FROM cv_versions c WHERE c.job_id=j.job_id AND c.profile_version=$1) existing_cv_manifests FROM jobs j JOIN LATERAL
  (SELECT analysis_json FROM job_analysis WHERE job_id=j.job_id ORDER BY created_at DESC,analysis_id DESC LIMIT 1) a ON true
  WHERE j.availability_status='OPEN'
  AND a.analysis_json->>'decision' IN ('REVIEW','STRETCH','AUTO_APPLY')
  AND (a.analysis_json->>'overall_fit')::numeric>=45
  AND a.analysis_json->>'profile_hash'=$1
  AND a.analysis_json->>'policy_hash'=$2
  AND a.analysis_json->>'job_content_hash'=j.content_hash
  AND a.analysis_json->>'prompt_version'=$3
  ORDER BY coalesce((a.analysis_json->>'application_priority')::numeric,0) DESC,j.first_seen_at LIMIT 1000`,[digest(profile),digest(policy),PROMPT_VERSION])).rows;
  return rows.filter(row=>eligibleCvAnalysis(row,row.analysis_json,profile,policy)&&!row.existing_cv_manifests.some(manifest=>
   currentTailoredCv(manifest,row,row.analysis_json)));}
 async preparationCandidates(profile,policy){const rows=(await this.repository.pool.query(`SELECT j.*,a.analysis_json,c.cv_id,c.manifest_json AS cv_manifest_json,app.application_id,app.status AS application_status,
  app.last_state FROM jobs j JOIN LATERAL (SELECT * FROM job_analysis WHERE job_id=j.job_id ORDER BY created_at DESC,analysis_id DESC LIMIT 1) a ON true
  JOIN cv_versions c ON c.job_id=j.job_id AND c.profile_version=$1 AND c.qa_json->>'pass'='true'
  AND c.manifest_json->>'application_eligible'='true' AND c.manifest_json->>'job_content_hash'=j.content_hash
  AND c.template_version=$3 AND c.qa_json->'tailoring'->>'pass'='true'
  LEFT JOIN applications app ON app.job_id=j.job_id AND app.candidate_profile_id=$2
  WHERE j.availability_status='OPEN' AND a.decision IN('REVIEW','STRETCH','AUTO_APPLY') AND a.overall_fit>=45
  AND a.analysis_json->>'profile_hash'=$1 AND a.analysis_json->>'job_content_hash'=j.content_hash
  AND a.analysis_json->>'policy_hash'=$4
  AND a.analysis_json->>'prompt_version'=$5
  AND (app.application_id IS NULL OR (app.status IN('QUEUED','OPENING','FILLING') AND app.dry_run=true))
  ORDER BY j.first_seen_at,c.created_at DESC LIMIT 100`,[digest(profile),profile.profile_id,CV_V2_VERSION,digest(policy),PROMPT_VERSION])).rows;
  const seen=new Set();return rows.filter(row=>{if(seen.has(row.job_id)||!eligibleAnalysis(row,row.analysis_json,profile,policy)||!currentTailoredCv(row.cv_manifest_json,row,row.analysis_json))return false;seen.add(row.job_id);return true;});}
}

/** Independent lane ticks are injectable for deterministic scheduler tests. */
export function createContinuousWorker({store,profile,policy={},loadConfiguration=async()=>({profile,policy}),discovery,buildQueue,fit,cv,prose,prepare,apply,notify,modelBusy,
 enabled=process.env.CONTINUOUS_WORKER_ENABLED==='true',dryRun=process.env.DRY_RUN==='true',
 allowRealSubmit=process.env.ALLOW_REAL_SUBMIT==='true',intervalMs=60000,onError=()=>{}}){
 if(!enabled)throw new Error('CONTINUOUS_WORKER_AUTHORIZATION_REQUIRED');
 if(!dryRun||allowRealSubmit)throw new Error('CONTINUOUS_WORKER_REQUIRES_DRY_RUN');
 if(!Number.isInteger(intervalMs)||intervalMs<10)throw new Error('INVALID_WORKER_INTERVAL');
 let nextModel='fit',proseTurn=false,scheduleLoaded=false;const states={};
 const saveSchedule=async()=>{if(store.saveModelSchedule)await store.saveModelSchedule({nextModel,proseTurn});};
 async function claimed(key,lane,entityId,operation){if(!(await store.claim(key,lane,entityId)))return false;
  const heartbeat=store.heartbeat&&setInterval(()=>store.heartbeat(key).catch(()=>{}),60000);
  try{const result=await operation();
   if(result?.blocked_reason||result?.prose_pending){await store.finish(key,'RETRY',safeCode(result.blocked_reason??'MODEL_PROSE_PENDING'));return true;}
   if(lane==='cv' && /^BLOCKED_/.test(result?.status??'')){
    await store.finish(key,'RETRY',safeCode(result.status));return true;}
   const state=lane==='cv'&&result?.status!=='REGISTERED'?'DRAFT_PENDING_VISUAL':waiting.has(result?.status)?'WAITING_USER':'COMPLETED';
   await store.finish(key,state,lane==='cv'&&result?.status!=='REGISTERED'?'VISUAL_QA_REQUIRED':safeCode(result?.status??'COMPLETED'));return true;
  }catch(error){await store.finish(key,'RETRY',safeCode(error.code??error.message));throw error;}
  finally{if(heartbeat)clearInterval(heartbeat);}}
 async function tick(lane){states[lane]='RUNNING';await store.status(lane,'RUNNING');
  try{if(await store.paused()){states[lane]='PAUSED';await store.status(lane,'PAUSED');return;}
   const context=structuredClone(await loadConfiguration());const {profile,policy}=context;
   if(!profile||!policy)throw new Error('CURRENT_CONFIGURATION_REQUIRED');
   if(lane==='ingestion')await discovery(context);
   else if(lane==='screening')await buildQueue(context);
   else if(lane==='model'){
    if(modelBusy&&await modelBusy()){states[lane]='IDLE';await store.status(lane,'IDLE','MODEL_INSTANCE_BUSY');return;}
    if(!scheduleLoaded){if(store.loadModelSchedule)({nextModel,proseTurn}=await store.loadModelSchedule());scheduleLoaded=true;}
    if(prose&&proseTurn){proseTurn=false;await saveSchedule();const drafted=await prose(context);if(drafted?.processed>0){states[lane]='IDLE';await store.status(lane,'IDLE');return;}}
    const candidates=await store.cvCandidates(profile,policy);
    const generate=async()=>{for(const job of candidates){const key=cvWorkKey(job,job.analysis_json,profile);
     if(await claimed(key,'cv',job.job_id,()=>cv(job.job_id,context)))return true;}return false;};
    if(nextModel==='cv'){nextModel='fit';proseTurn=true;await saveSchedule();if(!(await generate()))await fit(context);}
    else {nextModel='cv';await saveSchedule();await fit(context);}
   } else if(lane.startsWith('preparation-')){
    for(const row of await store.preparationCandidates(profile,policy)){
     if(waiting.has(row.application_status)||row.last_state?.ready_stop||row.last_state?.captcha)continue;
     const key='prepare:'+digest([profile.profile_id,row.job_id,digest(profile),digest(policy),CV_V2_VERSION,row.cv_id]);
     if(await claimed(key,'preparation',row.job_id,async()=>{
      const app=row.application_id?row:await prepare(row.job_id,row.cv_id,context);
      return apply(row.job_id,app.application_id,context);
     }))break;
    }
   } else if(lane==='notifications')await notify(context);
   states[lane]='IDLE';await store.status(lane,'IDLE');
  }catch(error){states[lane]='RETRY';await store.status(lane,'RETRY',safeCode(error.code??error.message));onError({lane,code:safeCode(error.code??error.message)});}
 }
 async function laneLoop(lane,signal){const release=await store.acquireLane(lane);if(!release)return;
  try{while(!signal.aborted){await tick(lane);if(signal.aborted)break;
   await new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};
    const timer=setTimeout(done,intervalMs);signal.addEventListener('abort',done,{once:true});});}
  }finally{await release();}}
 const lanes=['ingestion','screening','model','preparation-1','preparation-2','notifications'];
 return {tick,states,start:signal=>Promise.all(lanes.map(lane=>laneLoop(lane,signal)))};
}

export async function createProductionContinuousWorker({repository,configDir='config',core,intervalMs=60000,workerStartedAt=new Date().toISOString()}){
 const [{readFile},YAML,{runMarketDiscovery},{buildRelevanceQueue,runRelevanceFitBatch},{OllamaClient},
  {createControlledPreparation},{runApplication,BrowserClient},{browserConfig},{Telegram},{drainCaptchaHandoffs}]=await Promise.all([
  import('node:fs/promises'),import('yaml'),import('./discovery-v2.mjs'),import('./relevance-queue.mjs'),import('./llm.mjs'),
  import('./controlled-preparation.mjs'),import('./application.mjs'),import('../browser-service/server.mjs'),import('./telegram.mjs'),import('./captcha-handoff.mjs')]);
 const loadConfiguration=async()=>{const [profileText,policyText]=await Promise.all([readFile(`${configDir}/candidate_profile.yaml`,'utf8'),readFile(`${configDir}/search_policy.yaml`,'utf8')]);
  return {profile:YAML.default.parse(profileText),policy:YAML.default.parse(policyText)};};
 const llm=new OllamaClient(),browser=new BrowserClient(),telegram=new Telegram(),config=browserConfig();
 const ensureCurrent=async snapshot=>{const current=await loadConfiguration();
  if(digest(current.profile)!==digest(snapshot.profile)||digest(current.policy)!==digest(snapshot.policy))throw new Error('CONFIGURATION_CHANGED_DURING_OPERATION');};
 return createContinuousWorker({store:new ContinuousStore(repository),loadConfiguration,intervalMs,
  modelBusy:async()=>{const {localModelBusy}=await import('./model-busy.mjs');return localModelBusy(llm.model);},
  discovery:async()=>{const {runParallelDiscovery}=await import('./parallel-discovery.mjs');return runParallelDiscovery({repository,concurrency:6});},buildQueue:async({profile,policy})=>{const {applyDeterministicHardRejects}=await import('./relevance-queue.mjs');await buildRelevanceQueue({repository});return applyDeterministicHardRejects({repository,profile,policy});},
  prose:async({profile,policy})=>{const {drain}=await import('./application-prose.mjs');return drain({repo:repository,profile,policy,llm,max:1});},
  fit:({profile,policy})=>runRelevanceFitBatch({repository,profile,policy,llm,maxJobs:1,maxRuntimeMs:llm.timeoutMs+60000,inferenceAuthorized:true}),
  cv:async (jobId,context)=>{await ensureCurrent(context);const manifest=await core.stage(4,{job_id:jobId});
   if(manifest?.blocked_reason||manifest?.status!=='PASS')return manifest;
   await ensureCurrent(context);
   const {registerIndependentCv}=await import('./cv-independent-qa.mjs');
   return registerIndependentCv({repository,manifest,profile:context.profile});},
  prepare:async(jobId,cvId,context)=>{await ensureCurrent(context);return createControlledPreparation({repository,jobId,cvId,profile:context.profile,policy:context.policy});},
  apply:async(jobId,applicationId,context)=>{await ensureCurrent(context);return runApplication({repository,jobId,applicationId,profile:context.profile,policy:context.policy,browser,telegram,
   config:{...config,dryRun:true,allowRealSubmit:false}});},
  notify:async({profile})=>{const {enqueueRegisteredCvDocuments,drainRegisteredCvDocuments}=await import('./document-delivery.mjs');
   const results=await Promise.allSettled([drainCaptchaHandoffs({repository,browser,telegram}),
    (async()=>{await enqueueRegisteredCvDocuments({repo:repository,profile,since:workerStartedAt});
     return drainRegisteredCvDocuments({repo:repository,profile,telegram});})()]);
   if(results.some(result=>result.status==='rejected'))throw new Error('NOTIFICATION_LANE_PARTIAL_FAILURE');
   return results.map(result=>result.value);},
  onError:event=>console.error(JSON.stringify({event:'CONTINUOUS_LANE_RETRY',...event}))});
}
