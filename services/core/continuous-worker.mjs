import {randomUUID,createHash} from 'node:crypto';
import {canonicalAnalysisHash} from './evidence-hash.mjs';
import {CV_V2_VERSION,compatibleCvTemplate} from './cv-v2.mjs';
import {workFormatAnalysis,PROMPT_VERSION} from './fit.mjs';
import {batchProgress,finishBatchNormalization} from './pipeline-batch.mjs';

const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const safeCode=value=>/^[A-Z][A-Z0-9_]{0,79}$/.test(value??'')?value:'OPERATION_FAILED';
const waiting=new Set(['NEEDS_USER','CAPTCHA_WAIT','MANUAL_TAKEOVER','MANUAL','READY_STOP','READY_TO_SUBMIT']);
export function cvWorkKey(job,analysis,profile,templateVersion=CV_V2_VERSION){return 'cv:'+digest([templateVersion,job.job_id,job.content_hash,canonicalAnalysisHash(analysis),digest(profile)]);}
function currentNonBlockedAnalysis(job,analysis,profile,policy={},requireOpen=true){return (requireOpen?job.availability_status==='OPEN':job.availability_status!=='CLOSED')
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
export function eligibleCvAnalysis(job,analysis,profile,policy={}){return currentNonBlockedAnalysis(job,analysis,profile,policy,false);}

export function currentTailoredCv(manifest,job,analysis){return manifest?.template_version===CV_V2_VERSION&&manifest?.qa?.tailoring?.pass===true
 && manifest.job_content_hash===job.content_hash&&manifest.analysis_hash===canonicalAnalysisHash(analysis);}

export class ContinuousStore {
 constructor(repository,{ownerId=randomUUID(),leaseMs=300000}={}){this.repository=repository;this.ownerId=ownerId;this.leaseMs=leaseMs;}
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
 async phaseBarrier(profile,policy){const key=digest([profile,policy]);if(this.batchCache?.key===key&&Date.now()-this.batchCache.at<3000)return this.batchCache.value;
  const value=await batchProgress(this.repository,profile,policy);this.batchCache={key,at:Date.now(),value};return value;}
 async normalizeBatch(id){return finishBatchNormalization(this.repository,id);}
 async resumeTask(){return (await this.repository.pool.query('SELECT resume_model_task FROM runtime_control WHERE id=true')).rows[0]?.resume_model_task;}
 async clearResumeTask(){await this.repository.pool.query('UPDATE runtime_control SET resume_model_task=NULL WHERE id=true');}
 async pendingFitCount(profile,policy){return Number((await this.repository.pool.query(`SELECT count(*)::int count FROM relevance_queue q JOIN jobs j USING(job_id)
  WHERE q.status IN ('QUEUED','RETRY','RUNNING','ANALYZED') AND (q.next_retry_at IS NULL OR q.next_retry_at<=now())
  AND NOT EXISTS(SELECT 1 FROM job_analysis a WHERE a.job_id=q.job_id AND a.analysis_json->>'profile_hash'=$1 AND a.analysis_json->>'policy_hash'=$2 AND a.analysis_json->>'job_content_hash'=j.content_hash)
  `,[digest(profile),digest(policy)])).rows[0].count);}
 async hasPendingFit(profile,policy){return (await this.pendingFitCount(profile,policy))>0;}
 async runnableCvCandidates(profile,policy){const candidates=await this.cvCandidates(profile,policy);if(!candidates.length)return [];
  const keys=candidates.map(job=>cvWorkKey(job,job.analysis_json,profile));const unavailable=new Set((await this.repository.pool.query("SELECT work_key FROM continuous_work WHERE work_key=ANY($1::text[]) AND NOT(status='RETRY' AND next_retry_at<=now() OR status='RUNNING' AND lease_until<now())",[keys])).rows.map(r=>r.work_key));
  return candidates.filter((job,i)=>!unavailable.has(keys[i]));}
 async higherPriorityPending(profile,policy){if(await this.hasPendingFit(profile,policy))return 'FIT';if((await this.runnableCvCandidates(profile,policy)).length)return 'CV';
  return (await this.repository.pool.query("SELECT 1 FROM continuous_work w JOIN continuous_worker_status s ON s.owner_id=w.owner_id AND s.lane='model' WHERE w.lane='cv' AND w.status='RUNNING' LIMIT 1")).rowCount?'CV':null;}

 async cvCandidates(profile,policy){const rows=(await this.repository.pool.query(`SELECT j.job_id,j.title,j.company,j.content_hash,j.availability_status,j.location,j.country,j.work_mode,j.first_seen_at,j.description_text,a.analysis_json,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('template_version',c.template_version,'job_content_hash',c.manifest_json->>'job_content_hash','analysis_hash',c.manifest_json->>'analysis_hash','qa',jsonb_build_object('tailoring',jsonb_build_object('pass',c.qa_json->'tailoring'->'pass')))),'[]'::jsonb) FROM cv_versions c WHERE c.job_id=j.job_id AND c.profile_version=$1) existing_cv_manifests FROM jobs j JOIN LATERAL
  (SELECT analysis_json FROM job_analysis WHERE job_id=j.job_id ORDER BY created_at DESC,analysis_id DESC LIMIT 1) a ON true
  WHERE j.availability_status<>'CLOSED'
  AND a.analysis_json->>'decision' IN ('REVIEW','STRETCH','AUTO_APPLY')
  AND (a.analysis_json->>'overall_fit')::numeric>=45
  AND a.analysis_json->>'profile_hash'=$1
  AND a.analysis_json->>'policy_hash'=$2
  AND a.analysis_json->>'job_content_hash'=j.content_hash
  AND a.analysis_json->>'prompt_version'=$3
  AND NOT EXISTS(SELECT 1 FROM applications app WHERE app.job_id=j.job_id AND app.candidate_profile_id=$4 AND app.status IN ('SUBMITTED','SKIPPED','ALREADY_APPLIED','SUBMISSION_UNKNOWN','READY_TO_SUBMIT','NEEDS_USER','CAPTCHA_WAIT','MANUAL_TAKEOVER'))
  ORDER BY (a.analysis_json->>'overall_fit')::numeric DESC NULLS LAST,coalesce((a.analysis_json->>'application_priority')::numeric,0) DESC,j.first_seen_at`,[digest(profile),digest(policy),PROMPT_VERSION,profile.profile_id])).rows;
  return rows.filter(row=>eligibleCvAnalysis(row,row.analysis_json,profile,policy)&&!row.existing_cv_manifests.some(manifest=>
   currentTailoredCv(manifest,row,row.analysis_json)));}
 async calculatePreparationCandidates(profile,policy){const rows=(await this.repository.pool.query(`SELECT j.*,a.analysis_json,c.cv_id,c.manifest_json AS cv_manifest_json,app.application_id,app.status AS application_status,
  app.last_state FROM jobs j JOIN LATERAL (SELECT * FROM job_analysis WHERE job_id=j.job_id ORDER BY created_at DESC,analysis_id DESC LIMIT 1) a ON true
  JOIN cv_versions c ON c.job_id=j.job_id AND c.profile_version=$1 AND c.qa_json->>'pass'='true'
  AND c.manifest_json->>'application_eligible'='true' AND c.manifest_json->>'job_content_hash'=j.content_hash
  AND c.template_version IN ($3,'cv-factory-v2.3-exact-vacancy') AND c.qa_json->'tailoring'->>'pass'='true'
  LEFT JOIN applications app ON app.job_id=j.job_id AND app.candidate_profile_id=$2
  WHERE j.availability_status='OPEN' AND a.decision IN('REVIEW','STRETCH','AUTO_APPLY') AND a.overall_fit>=45
  AND a.analysis_json->>'profile_hash'=$1 AND a.analysis_json->>'job_content_hash'=j.content_hash
  AND a.analysis_json->>'policy_hash'=$4
  AND a.analysis_json->>'prompt_version'=$5
  AND (app.application_id IS NULL OR (app.status IN('QUEUED','OPENING','FILLING') AND app.dry_run=true))
  ORDER BY a.overall_fit DESC,j.first_seen_at,c.created_at DESC`,[digest(profile),profile.profile_id,CV_V2_VERSION,digest(policy),PROMPT_VERSION])).rows;
  const seen=new Set();return rows.filter(row=>{const continuing=row.application_id&&compatibleCvTemplate(row.cv_manifest_json?.template_version)&&row.cv_manifest_json?.qa?.tailoring?.pass&&row.cv_manifest_json.job_content_hash===row.content_hash&&row.cv_manifest_json.analysis_hash===canonicalAnalysisHash(row.analysis_json);if(seen.has(row.job_id)||!eligibleAnalysis(row,row.analysis_json,profile,policy)||!currentTailoredCv(row.cv_manifest_json,row,row.analysis_json)&&!continuing)return false;seen.add(row.job_id);return true;});}
 async preparationCandidates(profile,policy){const key=digest([profile,policy]),old=this.prepCache;if(old?.key===key&&Date.now()-old.at<3000)return old.value;if(old?.key===key&&old.pending)return old.pending;const state={key,at:0,value:null,pending:null};state.pending=this.calculatePreparationCandidates(profile,policy).then(value=>{state.value=value;state.at=Date.now();state.pending=null;return value;}).catch(error=>{this.prepCache=null;throw error;});this.prepCache=state;return state.pending;}
}

/** Independent lane ticks are injectable for deterministic scheduler tests. */
export function createContinuousWorker({store,profile,policy={},loadConfiguration=async()=>({profile,policy}),discovery,buildQueue,fit,cv,prose,prepare,apply,notify,modelBusy,autoSubmit,validateSource,preparationWorkers=2,submitWorkers=2,sourceWorkers=2,
 enabled=process.env.CONTINUOUS_WORKER_ENABLED==='true',dryRun=process.env.DRY_RUN==='true',
 allowRealSubmit=process.env.ALLOW_REAL_SUBMIT==='true',intervalMs=60000,onError=()=>{}}){
 if(!enabled)throw new Error('CONTINUOUS_WORKER_AUTHORIZATION_REQUIRED');
 if(!dryRun||allowRealSubmit)throw new Error('CONTINUOUS_WORKER_REQUIRES_DRY_RUN');
 if(!Number.isInteger(preparationWorkers)||preparationWorkers<1||preparationWorkers>24||!Number.isInteger(submitWorkers)||submitWorkers<1||submitWorkers>8||!Number.isInteger(sourceWorkers)||sourceWorkers<1||sourceWorkers>8)throw Error('INVALID_WORKER_CONCURRENCY');
 if(!Number.isInteger(intervalMs)||intervalMs<10)throw new Error('INVALID_WORKER_INTERVAL');
 const states={};let cvHitlTurn=false,applicationModelTurn=true;
 async function claimed(key,lane,entityId,operation){if(!(await store.claim(key,lane,entityId)))return false;
  const heartbeat=store.heartbeat&&setInterval(()=>store.heartbeat(key).catch(()=>{}),60000);
  try{const result=await operation();
   if(result?.blocked_reason||result?.prose_pending){await store.finish(key,'RETRY',safeCode(result.blocked_reason??'MODEL_PROSE_PENDING'));if(lane==='auto-submit'&&result.blocked_reason==='MODEL_FORM_REVIEW_PENDING'||lane==='preparation'&&result.prose_pending)await store.repository.pool.query("UPDATE continuous_work SET next_retry_at=now()+interval '5 seconds' WHERE work_key=$1 AND owner_id=$2",[key,store.ownerId]);return true;}
   if(lane==='cv'&&result?.fast_path_fallback){await store.finish(key,'DRAFT_PENDING_VISUAL','EXTRACTIVE_CV_REQUIRES_REVIEW');return true;}
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
   const barrier=store.phaseBarrier?await store.phaseBarrier(profile,policy):null;
   const blocked=barrier&&(lane==='ingestion'&&barrier.discovery_paused||barrier.phase==='NORMALIZE'&&!['screening','notifications'].includes(lane)||lane.startsWith('validation-')&&barrier.phase!=='CV_HITL'||['FIT','CV'].includes(barrier.phase)&&lane.startsWith('preparation-')&&!autoSubmit);
   if(blocked){states[lane]='WAITING';await store.status(lane,'IDLE',lane==='ingestion'?'DISCOVERY_FROZEN':`${barrier.phase}_BARRIER`);return;}
   if(lane==='screening'&&barrier?.phase==='NORMALIZE'&&store.normalizeBatch)await store.normalizeBatch(barrier.batch_id);
   if(lane==='ingestion')await discovery(context);
   else if(lane==='screening')await buildQueue(context);
   else if(lane==='model'){
    const busy=modelBusy&&await modelBusy();
    if(busy&&barrier?.phase!=='CV'){states[lane]='IDLE';await store.status(lane,'IDLE','MODEL_INSTANCE_BUSY');return;}
    if(autoSubmit&&prose&&!busy&&applicationModelTurn){const answer=await prose(context);if(answer?.processed){applicationModelTurn=false;states[lane]='IDLE';await store.status(lane,'IDLE','APPLICATION_MODEL_PRIORITY');return;}}
    const needsFit=barrier?barrier.phase==='FIT':true;
    const fitted=busy||!needsFit?{attempted:0}:await fit(context);
    if((fitted?.attempted??0)>0||fitted?.blocked_reason){applicationModelTurn=true;states[lane]='IDLE';await store.status(lane,'IDLE','FIT_PRIORITY');return;}
    if(barrier?.phase==='FIT'){states[lane]='IDLE';await store.status(lane,'IDLE','FIT_BATCH_NOT_100_PERCENT');return;}
    if(store.hasPendingFit&&await store.hasPendingFit(profile,policy)){states[lane]='IDLE';await store.status(lane,'IDLE','FIT_PENDING_CV_FORBIDDEN');return;}

    const candidates=barrier?.phase==='CV_HITL'?[]:await (store.runnableCvCandidates?store.runnableCvCandidates(profile,policy):store.cvCandidates(profile,policy));
    const resume=store.resumeTask&&await store.resumeTask();if(resume?.type==='CV'){candidates.sort((a,b)=>Number(b.job_id===resume.job_id)-Number(a.job_id===resume.job_id));if(store.clearResumeTask)await store.clearResumeTask();}
    for(const job of candidates){const key=cvWorkKey(job,job.analysis_json,profile);if(await claimed(key,'cv',job.job_id,()=>cv(job.job_id,context))){cvHitlTurn=true;applicationModelTurn=true;states[lane]='IDLE';await store.status(lane,'IDLE','CV_PRIORITY');return;}}
    if(barrier?.phase==='CV'){states[lane]='WAITING_REVIEW';await store.status(lane,'IDLE','CV_REVIEW_REQUIRED');return;}
    const proseResult=prose?await prose(context):null;applicationModelTurn=true;
    if(!proseResult?.processed){states[lane]='EMPTY_QUEUE';await store.status(lane,'IDLE','MODEL_QUEUE_EMPTY');return;}
   } else if(lane.startsWith('preparation-')){
    const priority=autoSubmit||barrier?.phase==='CV_HITL'?null:store.higherPriorityPending&&await store.higherPriorityPending(profile,policy);if(priority){states[lane]='IDLE';await store.status(lane,'IDLE',`${priority}_PRIORITY`);return;}
    for(const row of await store.preparationCandidates(profile,policy)){
     if(waiting.has(row.application_status)||row.last_state?.ready_stop||row.last_state?.captcha)continue;
     const key='prepare:'+digest([profile.profile_id,row.job_id,digest(profile),digest(policy),CV_V2_VERSION,row.cv_id]);
     if(await claimed(key,'preparation',row.job_id,async()=>{
      const app=row.application_id?row:await prepare(row.job_id,row.cv_id,context);
      return apply(row.job_id,app.application_id,context,row.cv_id);
     }))break;
    }
   } else if(lane.startsWith('validation-')&&validateSource){const {validationCandidates}=await import('./source-validation.mjs');for(const job of await validationCandidates(store.repository,profile,policy)){const key=`source:${job.job_id}:${job.content_hash}`;if(await claimed(key,'source-validation',job.job_id,()=>validateSource(job,context)))break;}
   } else if(lane.startsWith('submit-')&&autoSubmit){
    const grant=await (await import('./autonomous-authorization.mjs')).autonomousAuthorization(profile);
    for(const app of (await store.repository.pool.query("SELECT application_id FROM applications a WHERE candidate_profile_id=$1 AND status='READY_TO_SUBMIT' AND NOT EXISTS(SELECT 1 FROM confirmed_submit_commands c WHERE c.application_id=a.application_id AND c.superseded_at IS NULL) ORDER BY updated_at LIMIT 20",[profile.profile_id])).rows){
     if(await claimed(`auto-submit:${grant.authorization_id}:${app.application_id}`,'auto-submit',app.application_id,()=>autoSubmit(app.application_id,context)))break;
    }
   } else if(lane==='notifications')await notify(context);
   states[lane]='IDLE';await store.status(lane,'IDLE');
  }catch(error){states[lane]='RETRY';await store.status(lane,'RETRY',safeCode(error.code??error.message));onError({lane,code:safeCode(error.code??error.message)});}
 }
 async function laneLoop(lane,signal){const release=await store.acquireLane(lane);if(!release)return;
  try{while(!signal.aborted){await tick(lane);if(signal.aborted)break;
   await new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};
    const delay=lane==='model'?(['WAITING_REVIEW','EMPTY_QUEUE'].includes(states[lane])?(autoSubmit?Math.min(intervalMs,3000):Math.max(intervalMs,30000)):Math.min(intervalMs,100)):(lane.startsWith('preparation-')||lane.startsWith('submit-')||lane.startsWith('validation-'))?Math.min(intervalMs,5000):lane==='notifications'?Math.min(intervalMs,10000):intervalMs;
    const timer=setTimeout(done,delay);signal.addEventListener('abort',done,{once:true});});}
  }finally{await release();}}
 const lanes=['ingestion','screening','model',...Array.from({length:preparationWorkers},(_,i)=>`preparation-${i+1}`),...(autoSubmit?Array.from({length:submitWorkers},(_,i)=>`submit-${i+1}`):[]),...(validateSource?Array.from({length:sourceWorkers},(_,i)=>`validation-${i+1}`):[]),'notifications'];
 return {tick,states,lanes,start:signal=>Promise.all(lanes.map(lane=>laneLoop(lane,signal)))};
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
  discovery:async()=>{const {runParallelDiscovery}=await import('./parallel-discovery.mjs');return runParallelDiscovery({repository,concurrency:6});},buildQueue:async({profile,policy})=>{const {applyDeterministicHardRejects}=await import('./relevance-queue.mjs');await buildRelevanceQueue({repository});await repository.pool.query(`UPDATE relevance_queue q SET status='ANALYZED',error_code='CURRENT_FIT_REUSED',next_retry_at=NULL,updated_at=now() FROM jobs j WHERE j.job_id=q.job_id AND q.status IN('QUEUED','RETRY') AND EXISTS(SELECT 1 FROM job_analysis a WHERE a.job_id=q.job_id AND a.analysis_json->>'profile_hash'=$1 AND a.analysis_json->>'policy_hash'=$2 AND a.analysis_json->>'job_content_hash'=j.content_hash)`,[digest(profile),digest(policy)]);return applyDeterministicHardRejects({repository,profile,policy});},
  prose:async({profile,policy})=>{if(process.env.AUTONOMOUS_APPLICATIONS_ENABLED==='true'){const {drainFormModelReviews}=await import('./form-model-review.mjs');const checked=await drainFormModelReviews({repository,profile,policy,llm,browser});if(checked?.processed)return checked;}const {drain}=await import('./application-prose.mjs');return drain({repo:repository,profile,policy,llm,max:1});},
  fit:async({profile,policy})=>{const resume=(await repository.pool.query('SELECT resume_model_task FROM runtime_control WHERE id=true')).rows[0]?.resume_model_task;const result=await runRelevanceFitBatch({repository,profile,policy,llm,maxJobs:resume?.type==='FIT'?1:8,jobIds:resume?.type==='FIT'?[resume.job_id]:undefined,maxRuntimeMs:120000,inferenceAuthorized:true});if(resume?.type==='FIT')await repository.pool.query('UPDATE runtime_control SET resume_model_task=NULL WHERE id=true');return result;},
  cv:async (jobId,context)=>{await ensureCurrent(context);const manifest=await core.stage(4,{job_id:jobId,prepare_cv:true});
   if(manifest?.blocked_reason||manifest?.status!=='PASS')return manifest;
   await ensureCurrent(context);
   const {registerIndependentCv}=await import('./cv-independent-qa.mjs');
   return registerIndependentCv({repository,manifest,profile:context.profile});},
  prepare:async(jobId,cvId,context)=>{await ensureCurrent(context);return createControlledPreparation({repository,jobId,cvId,profile:context.profile,policy:context.policy});},
  apply:async(jobId,applicationId,context,cvId)=>{await ensureCurrent(context);if(cvId){const {refreshPreparationCv}=await import('./controlled-preparation.mjs');const refreshed=await refreshPreparationCv({repository,applicationId,cvId,profile:context.profile,policy:context.policy});if(refreshed.blocked_reason)return refreshed;}return runApplication({repository,jobId,applicationId,profile:context.profile,policy:context.policy,browser,telegram,
   config:{...config,dryRun:true,allowRealSubmit:false,fillAllFields:process.env.APPLICATION_FILL_ALL_FIELDS==='true'}});},
  notify:async({profile})=>{
   const {sendReadyApplications}=await import('./telegram-applications.mjs');
   const results=await Promise.allSettled([drainCaptchaHandoffs({repository,browser,telegram}),
    telegram.sendDeferredQuestions(repository),
    sendReadyApplications({repository,profile,browser,telegram})]);
   if(results.some(result=>result.status==='rejected'))throw new Error('NOTIFICATION_LANE_PARTIAL_FAILURE');
   return results.map(result=>result.value);},
  sourceWorkers:Number(process.env.SOURCE_VALIDATION_WORKERS??2),validateSource:process.env.AUTONOMOUS_APPLICATIONS_ENABLED==='true'?async(job,{profile,policy})=>(await import('./source-validation.mjs')).validateSourceForCv({repository,job,profile,policy}):null,
  preparationWorkers:Number(process.env.APPLICATION_PREPARATION_WORKERS??2),submitWorkers:Number(process.env.APPLICATION_SUBMIT_WORKERS??2),
  autoSubmit:process.env.AUTONOMOUS_APPLICATIONS_ENABLED==='true'?async(applicationId,{profile})=>(await import('./autonomous-submit.mjs')).submitAutonomousApplication({repository,applicationId,profile,browser}):null,
  onError:event=>console.error(JSON.stringify({event:'CONTINUOUS_LANE_RETRY',...event}))});
}
