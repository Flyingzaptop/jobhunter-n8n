import { createHash, randomUUID } from 'node:crypto';
import { analyzeJob, PROMPT_VERSION, sourceFragmentCatalog } from './fit.mjs';
import {LLM_GATEWAY_VERSION} from './llm.mjs';
import { reverifyMarketJob } from './discovery-v2.mjs';
import { computePriority } from './priority.mjs';
import { retryPlan } from './analysis-retry.mjs';
import { runObserved, observe, operationContext } from './observability.mjs';

export const RELEVANCE_VERSION = 'relevance-v1.3-wroclaw-and-worldwide-remote';
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/gi,'l').toLowerCase();
const europe = /^(?:pl|de|fr|gb|uk|ie|nl|be|cz|at|se|fi|dk|no|ch|es|it|pt|lt|lv|ee|ro|hu|sk|si|hr|poland|germany|france|united kingdom|ireland|netherlands|belgium|czechia|austria|sweden|finland|denmark|norway|switzerland|spain|italy|portugal|european union|europe)$/;
const patterns = {
  mechanical_rd: /\b(?:mechanical|mechatronic\w*|cad|cae|fea|cfd|konstruktor\w*|mechanik\w*|mechatronik\w*|konstruktion|sondermaschinenbau)\b|mechanical design|product development|research (?:engineer|assistant)|ingenieur.*(?:concep|cao|simulation)|aerospace|automotive/,
  simulation_test: /simulation|validation|(?:hardware|embedded|system|mechanical) test|test (?:engineer|system)|verifikation|verification|\b(?:hil|sil)\b|prototyp/,
  automation_robotics: /robotic\w*|automat(?:ion|yk\w*|ion engineer)|plc|controls engineer|embedded|mechatron/,
  python_data: /\bpython\b|machine learning|data scient\w*|scientific software|technical software|research software|computer vision|graphics engineer|gpu performance/,
  it_support: /\bit support\b|technical support|product support|systems? admin\w*|administrator (?:it|system)|informatyk|deployment (?:engineer|automation)|network engineer/,
};
const jobSnapshot = job => {
  const {metadata,...columns}=job; const result={...(metadata??{}),...columns}; delete result.metadata; return result;
};
export function relevanceInputHash(job) {
  const j=jobSnapshot(job);
  return hash({title:j.title,company:j.company,description:j.description_text,location:j.location,country:j.country,
    work_mode:j.work_mode,canonical_url:j.canonical_url,application_url:j.application_url,availability:j.availability_status});
}
export function fitInputHash({job,profile,policy,model,promptVersion=PROMPT_VERSION,gatewayVersion=LLM_GATEWAY_VERSION}) {
  return hash({job:relevanceInputHash(job),profile:hash(profile),policy:hash(policy),model,promptVersion,gatewayVersion});
}
export function screenRelevance(job,{now=new Date()}={}) {
  const j=jobSnapshot(job),title=fold(j.title),description=fold(j.description_text),location=fold(j.location),country=fold(j.country);
  const reasons=[],roles=[]; let score=0;
  const add=(signal,effect,evidence,field)=>{score+=effect;reasons.push({signal,effect,evidence:String(evidence??'').slice(0,250),source_field:field});};
  const titleSignals=[];let bodySignals=0;
  for(const [family,pattern] of Object.entries(patterns)) {
    const titleMatch=title.match(pattern); const bodyMatch=description.match(pattern);
    if(titleMatch&&(!/product support/.test(titleMatch[0])||/api|integration|troubleshoot|technical/.test(description))){roles.push(family);titleSignals.push(family==='mechanical_rd'?46:family==='simulation_test'?40:34);add(`TITLE_${family.toUpperCase()}`,0,titleMatch[0],'title');}
    else if(bodyMatch){roles.push(family);add(`DESCRIPTION_${family.toUpperCase()}`,bodySignals++<2?5:0,bodyMatch[0],'description_text');}
  }
  if(titleSignals.length){add('TARGET_TITLE_WEIGHT',Math.max(...titleSignals),title,'title');if(titleSignals.length>1)add('CROSS_DISCIPLINARY_TITLE',Math.min(8,4*(titleSignals.length-1)),roles.join(', '),'title');}
  const junior=title.match(/\b(?:junior|graduate|entry[- ]level|intern(?:ship)?|student|working student|werkstudent\w*|praktik(?:um|ant)\w*|trainee|mlodszy|alternan\w*|stagiaire)\b/);
  const senior=title.match(/\b(?:senior|staff|principal|director|head|lead|teamleiter|manager|vp)\b/);
  const seniority=junior?'JUNIOR_STUDENT':senior?'SENIOR_LEADERSHIP':'UNSPECIFIED';
  if(junior)add('JUNIOR_STUDENT_TITLE',22,junior[0],'title');
  if(senior)add('SENIOR_TITLE_DEPRIORITIZED',-26,senior[0],'title');
  if(!junior&&!senior)add('SENIORITY_UNKNOWN',4,'No explicit seniority; not assumed junior','title');
  if(/\b(?:account(?:ant|ing)|bookkeep\w*|clerk|recruiter|sales|marketing|finance|legal counsel)\b/.test(title))add('NONTARGET_TITLE_DEPRIORITIZED',-45,title,'title');
  const remote=j.work_mode==='REMOTE';
  const nearby=/wroclaw|wrocław/.test(location);
  const localMechanical=nearby&&reasons.some(reason=>reason.signal==='TITLE_MECHANICAL_RD');
  let locationClass='UNKNOWN';
  if(localMechanical&&!remote){locationClass=j.work_mode==='HYBRID'?'MECHANICAL_WROCLAW_HYBRID_HINT':'MECHANICAL_WROCLAW_HINT';add('MECHANICAL_NEAR_WROCLAW_PREFERENCE',24,j.location,'location');if(j.work_mode==='HYBRID')add('LOCAL_MECHANICAL_HYBRID_SLIGHT_PREFERENCE',3,'Hybrid mechanical role near Wroclaw','work_mode');}
  else if(remote){locationClass='REMOTE_ELIGIBILITY_UNKNOWN';add('WORLDWIDE_REMOTE_EQUAL_PRIORITY',24,`${j.country??''} ${j.location??''}; country restrictions require actual fit verification`,'country/location/work_mode');}
  else if(nearby){locationClass='WROCLAW_LOCATION_HINT';add('WROCLAW_PREFERENCE',4,j.location,'location');}
  else if(country==='pl'||country==='poland'||/\bpoland\b|warszawa|warsaw/.test(location)){locationClass='POLAND_LOCATION_HINT';add('POLAND_PREFERENCE',16,j.country||j.location,'country/location');}
  else if(europe.test(country)){locationClass='EUROPE_RELOCATION_REVIEW';add('EUROPE_DISCOVERY_PREFERENCE',10,j.country,'country');}
  else if(/\b(?:worldwide|europe|eu|eea|emea)\b/.test(location)){locationClass='BROAD_REGION_ELIGIBILITY_UNKNOWN';add('BROAD_REGION_PRIORITY_ONLY',10,j.location,'location');}
  else if(/\b(?:berlin|munich|london|dublin|paris|zurich|stockholm|cork)\b/.test(location)){locationClass='EUROPE_CITY_HINT_COUNTRY_UNVERIFIED';add('EUROPE_CITY_HINT',7,j.location,'location');}
  else if(country==='us'||country==='united states'||/\b(?:united states|usa)\b/.test(location)){locationClass='NON_EUROPE_ELIGIBILITY_REVIEW';add('NON_EUROPE_DEPRIORITIZED',-10,j.country||j.location,'country/location');}
  else if(['nz','new zealand','au','australia','ca','canada'].includes(country)||/\bnew zealand\b|\baustralia\b|(?:,\s*|^)nz$/.test(location)){locationClass='NON_EUROPE_ELIGIBILITY_REVIEW';add('NON_EUROPE_DEPRIORITIZED',-10,j.country||j.location,'country/location');}
  else add('LOCATION_UNKNOWN',0,'Location/eligibility must be verified; no Poland permission inferred','location');
  const date=Date.parse(j.published_at??j.first_seen_at??'');
  if(Number.isFinite(date)&&now-date<=14*86400000)add('RECENT_PUBLICATION_OR_SEEN',4,j.published_at??j.first_seen_at,'published_at/first_seen_at');
  if(/\b(?:phd|doctorate|doctoral)\b/.test(title))add('ADVANCED_DEGREE_TITLE_REVIEW',-15,title,'title');
  const hasTitle=Object.keys(patterns).some(family=>reasons.some(reason=>reason.signal===`TITLE_${family.toUpperCase()}`));
  const bounded=Math.max(0,Math.min(100,Math.round(score)));
  const status=j.availability_status==='CLOSED'?'CLOSED':hasTitle&&bounded>=40?'QUEUED':'LOW_PRIORITY';
  return {relevance_version:RELEVANCE_VERSION,input_hash:relevanceInputHash(j),relevance_score:bounded,status,
    role_hints:roles,reasons,location_class:locationClass,seniority_class:seniority,needs_hydration:(j.description_text??'').length<120,
    is_fit_analysis:false,employment_eligibility:'UNKNOWN',decision:null};
}

export async function buildRelevanceQueue({repository,observer=async()=>{},now=new Date()}={}) {
  const jobs=(await repository.listCanonicalJobs()).filter(j=>j.profile==='real'); const counts={}; let changed=0;
  for(const job of jobs){const q=screenRelevance(job,{now});
    const saved=await repository.pool.query(`INSERT INTO relevance_queue(job_id,relevance_version,input_hash,relevance_score,status,role_hints,reasons,location_class,seniority_class,needs_hydration)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(job_id) DO UPDATE SET relevance_version=EXCLUDED.relevance_version,input_hash=EXCLUDED.input_hash,
      relevance_score=EXCLUDED.relevance_score,role_hints=EXCLUDED.role_hints,reasons=EXCLUDED.reasons,location_class=EXCLUDED.location_class,
      seniority_class=EXCLUDED.seniority_class,needs_hydration=EXCLUDED.needs_hydration,status=CASE WHEN relevance_queue.status='RUNNING' THEN 'RUNNING'
        WHEN EXCLUDED.status='CLOSED' THEN 'CLOSED'
        WHEN relevance_queue.input_hash<>EXCLUDED.input_hash THEN EXCLUDED.status
        WHEN relevance_queue.status IN('LOW_PRIORITY','QUEUED') THEN EXCLUDED.status ELSE relevance_queue.status END,
      updated_at=now() RETURNING status,(xmax=0) AS inserted`,[job.job_id,q.relevance_version,q.input_hash,q.relevance_score,q.status,JSON.stringify(q.role_hints),JSON.stringify(q.reasons),q.location_class,q.seniority_class,q.needs_hydration]);
    const status=saved.rows[0].status;counts[status]=(counts[status]??0)+1; if(saved.rows[0].inserted)changed++;
    if(Object.values(counts).reduce((a,b)=>a+b,0)%250===0)await observer({event:'RELEVANCE_SCREEN_PROGRESS',processed:Object.values(counts).reduce((a,b)=>a+b,0),total:jobs.length});
  }
  return {scope:'DETERMINISTIC_MARKET_SCREEN_NOT_LLM_FIT',version:RELEVANCE_VERSION,total:jobs.length,inserted:changed,counts};
}
export async function listRelevanceCandidates(repository,{limit=500,minScore=40}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>5000)throw new Error('INVALID_RELEVANCE_LIMIT');
  return (await repository.pool.query(`SELECT j.*,q.relevance_score,q.role_hints,q.reasons,q.location_class,q.seniority_class,q.needs_hydration,q.status AS queue_status
    FROM relevance_queue q JOIN jobs j USING(job_id) WHERE q.relevance_score>=$1 AND q.status<>'CLOSED'
    ORDER BY CASE WHEN q.location_class='MECHANICAL_WROCLAW_HYBRID_HINT' THEN 0
      WHEN q.location_class='REMOTE_ELIGIBILITY_UNKNOWN' THEN 1 ELSE 2 END,
      q.relevance_score DESC,CASE WHEN q.seniority_class='JUNIOR_STUDENT' THEN 0 ELSE 1 END,j.first_seen_at,job_id LIMIT $2`,[minScore,limit])).rows.map(jobSnapshot);
}

export async function runRelevanceFitBatch({repository,profile,policy,llm,maxJobs=50,maxRuntimeMs=3600000,
  inferenceAuthorized=false,observer=observe,signal,regressionMode=false,analyzer=analyzeJob,verifier=reverifyMarketJob,jobIds}={}) {
  if(!inferenceAuthorized&&!regressionMode)throw new Error('BATCH_INFERENCE_AUTHORIZATION_REQUIRED');
  if((analyzer!==analyzeJob||verifier!==reverifyMarketJob)&&!regressionMode)throw new Error('INJECTED_GATEWAY_FORBIDDEN_IN_REAL_BATCH');
  if(!Number.isInteger(maxJobs)||maxJobs<1||maxJobs>1000||!Number.isFinite(maxRuntimeMs)||maxRuntimeMs<1000)throw new Error('INVALID_FIT_BATCH_LIMIT');
  if(jobIds&&(!Array.isArray(jobIds)||!jobIds.length||jobIds.some(id=>!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id))))throw new Error('INVALID_FIT_JOB_IDS');
  const lock=await repository.pool.connect();let acquired=false;
  const lockKey=regressionMode?'jobhunter.relevance-fit-batch-regression-'+(await lock.query('SELECT current_schema() schema')).rows[0].schema:'jobhunter.relevance-fit-batch';
  try {
    acquired=(await lock.query('SELECT pg_try_advisory_lock(hashtext($1)) locked',[lockKey])).rows[0].locked;
    if(!acquired)throw new Error('FIT_BATCH_ALREADY_RUNNING');
    return await runObserved(repository,3,{},async()=>{
      const runId=operationContext.getStore().run_id; const started=Date.now(); const results=[];const seen=new Set();let inferenceAttempts=0;
      await repository.pool.query("UPDATE relevance_queue SET status='RETRY',error_code='INTERRUPTED_FIT_BATCH',claimed_by=NULL,next_retry_at=now() WHERE status='RUNNING'");
      while(inferenceAttempts<maxJobs&&Date.now()-started<maxRuntimeMs&&!signal?.aborted){
        if((await repository.pool.query('SELECT paused FROM runtime_control WHERE id=true')).rows[0]?.paused)
          return {attempted:results.length,inference_attempted:inferenceAttempts,analyzed:results.filter(x=>x.status==='ANALYZED').length,
            errors:results.filter(x=>x.status!=='ANALYZED').map(x=>({job_id:x.job_id,status:x.status})),results,blocked_reason:'PAUSED'};
        const ready=(await repository.pool.query(`SELECT q.*,j.metadata AS job_metadata,j.canonical_url FROM relevance_queue q JOIN jobs j USING(job_id)
          WHERE q.status IN('QUEUED','RETRY','ANALYZED','DEAD_LETTER','OPEN_UNVERIFIED') AND (q.next_retry_at IS NULL OR q.next_retry_at<=now())
          AND ($1::uuid[] IS NULL OR q.job_id=ANY($1::uuid[])) ORDER BY array_position($1::uuid[],q.job_id),CASE
            WHEN q.location_class='MECHANICAL_WROCLAW_HYBRID_HINT' THEN 0
            WHEN q.location_class='REMOTE_ELIGIBILITY_UNKNOWN' THEN 1 ELSE 2 END,
            q.relevance_score DESC,q.job_id LIMIT 2000`,[jobIds??null])).rows;
        let selected=null;
        for(const row of ready){if(seen.has(row.job_id))continue;const job=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[row.job_id])).rows[0];
          const key=fitInputHash({job,profile,policy,model:llm.model});
          if(['DEAD_LETTER','OPEN_UNVERIFIED'].includes(row.status)&&row.active_fit_hash===key){seen.add(row.job_id);continue;}
          if((await repository.pool.query('SELECT 1 FROM fit_batch_receipts WHERE job_id=$1 AND fit_input_hash=$2',[row.job_id,key])).rowCount){seen.add(row.job_id);continue;}
          selected={row,job:jobSnapshot(job),key};break;}
        if(!selected)break;const {row}=selected;seen.add(row.job_id);let job=selected.job,key=selected.key;
        const claim=(await repository.pool.query(`UPDATE relevance_queue SET status='RUNNING',claimed_by=$2,claimed_at=now(),active_fit_hash=$3,
          attempt_count=CASE WHEN active_fit_hash=$3 THEN attempt_count+1 ELSE 1 END,next_retry_at=NULL WHERE job_id=$1 AND status<>'RUNNING' RETURNING attempt_count`,[row.job_id,runId,key])).rows[0];
        if(!claim)continue;
        await observer(repository,{event:'QUEUED_FIT_STARTED',entity_type:'job',entity_id:row.job_id,message:`Actual fit: ${job.company} — ${job.title}`,processed_count:results.length,total_count:maxJobs});
        try {
          const verification=await verifier({job,repository});if(verification.job)job=jobSnapshot(verification.job);
          if(verification.status!=='OPEN'){
            await repository.pool.query("UPDATE relevance_queue SET status=$2,error_code=$3,claimed_by=NULL WHERE job_id=$1",[row.job_id,verification.status==='CLOSED'?'CLOSED':'OPEN_UNVERIFIED','CURRENT_OFFICIAL_OPEN_NOT_CONFIRMED']);
            results.push({job_id:row.job_id,status:verification.status==='CLOSED'?'CLOSED':'OPEN_UNVERIFIED'});continue;
          }
          job.availability_status='OPEN';key=fitInputHash({job,profile,policy,model:llm.model});
          await repository.pool.query('UPDATE relevance_queue SET active_fit_hash=$2 WHERE job_id=$1',[row.job_id,key]);
          if((await repository.pool.query('SELECT 1 FROM fit_batch_receipts WHERE job_id=$1 AND fit_input_hash=$2',[row.job_id,key])).rowCount){
            await repository.pool.query("UPDATE relevance_queue SET status='ANALYZED',claimed_by=NULL,last_completed_hash=$2 WHERE job_id=$1",[row.job_id,key]);continue;
          }
          inferenceAttempts++;const analysis=await analyzer({job,profile,policy,llm});
          Object.assign(analysis,computePriority({job,analysis,policy}),{model:llm.model,prompt_version:PROMPT_VERSION,profile_version:profile.profile_version??profile.profile_id,
            profile_hash:hash(profile),policy_hash:hash(policy),job_content_hash:job.content_hash,fit_input_hash:key,runtime_statistics:llm.lastStats??null});
          const client=await repository.pool.connect();
          try{await client.query('BEGIN');
            const analysisId=randomUUID();
            await client.query(`INSERT INTO job_analysis(analysis_id,job_id,model,prompt_version,profile_version,overall_fit,application_priority,decision,analysis_json)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[analysisId,row.job_id,analysis.model,PROMPT_VERSION,analysis.profile_version??'UNKNOWN',analysis.overall_fit,analysis.application_priority,analysis.decision,analysis]);
            await client.query(`INSERT INTO fit_batch_receipts(job_id,fit_input_hash,analysis_id,run_id,model,profile_hash,policy_hash,prompt_version)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[row.job_id,key,analysisId,runId,llm.model,hash(profile),hash(policy),PROMPT_VERSION]);
            await client.query("UPDATE relevance_queue SET status='ANALYZED',input_hash=$2,last_completed_hash=$3,error_code=NULL,claimed_by=NULL,updated_at=now() WHERE job_id=$1",[row.job_id,relevanceInputHash(job),key]);
            await client.query("UPDATE jobs SET status='ANALYZED',last_analysis_error=NULL,next_analysis_retry_at=NULL,analysis_failure_kind=NULL WHERE job_id=$1",[row.job_id]);
            await client.query('INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json) VALUES($1,$2,$3,$4,$5)',
              [randomUUID(),'job',row.job_id,'QUEUED_FIT_ANALYZED',{run_id:runId,stage:3,decision:analysis.decision,overall_fit:analysis.overall_fit,fit_input_hash:key,model:llm.model,prompt_version:PROMPT_VERSION}]);
            await client.query('COMMIT');
          }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
          results.push({job_id:row.job_id,status:'ANALYZED',decision:analysis.decision,overall_fit:analysis.overall_fit,fit_input_hash:key});
        }catch(error){const plan=retryPlan(error,claim.attempt_count);
          await repository.pool.query("UPDATE relevance_queue SET status=$2,error_code=$3,next_retry_at=$4,claimed_by=NULL,updated_at=now() WHERE job_id=$1",[row.job_id,plan.retryable?'RETRY':'DEAD_LETTER',error.code??error.name,plan.next_retry_at]);
          results.push({job_id:row.job_id,status:plan.retryable?'RETRY':'DEAD_LETTER',error:error.name,retry_at:plan.next_retry_at});
          if(error.code==='HTTP_429')return {scope:'REAL_CLOUD_FIT',provider:llm.provider,model:llm.model,attempted:results.length,inference_attempted:inferenceAttempts,analyzed:results.filter(x=>x.status==='ANALYZED').length,results,blocked_reason:'PROVIDER_RATE_LIMIT',retry_at:plan.next_retry_at};
        }
          await observer(repository,{event:'QUEUED_FIT_PROGRESS',message:`Actual ${llm.model??'model'} jobs ${inferenceAttempts}/${maxJobs}; queue processed ${results.length}`,processed_count:results.length,
          success_count:results.filter(x=>x.status==='ANALYZED').length,failure_count:results.filter(x=>x.error).length});
      }
      return {scope:regressionMode?'REGRESSION_INJECTED_GATEWAY':llm.provider&&llm.provider!=='local'?'REAL_CLOUD_FIT':'REAL_LOCAL_FIT',provider:llm.provider??'local',model:llm.model,attempted:results.length,inference_attempted:inferenceAttempts,analyzed:results.filter(x=>x.status==='ANALYZED').length,
        selection_scope:jobIds?'EXPLICIT_ACTUAL_JOB_SUBSET':'DETERMINISTIC_RELEVANCE_QUEUE',selected_job_ids:jobIds??null,
        errors:results.filter(x=>x.status!=='ANALYZED').map(x=>({job_id:x.job_id,status:x.status,error:x.error})),results,cancelled:Boolean(signal?.aborted)};
    },{trigger:'relevance-queue',mode:regressionMode?'MOCK':'REAL'});
  } finally { if(acquired)await lock.query('SELECT pg_advisory_unlock(hashtext($1))',[lockKey]);lock.release(); }
}

export async function createCalibrationPack({repository,limit=20}={}) {
  const candidates=await listRelevanceCandidates(repository,{limit:Math.min(200,limit*5)});const items=[];
  for(const job of candidates){const fragment=sourceFragmentCatalog(job).find(f=>f.importance_hint&&!f.list_container&&!f.context_only&&!f.work_format_only);
    if(!fragment)continue;items.push({job_id:job.job_id,title:job.title,company:job.company,source_url:job.canonical_url,source_quote:fragment.text,
      importance_hint:fragment.importance_hint,author_type:'ASSISTANT_AGENT',review_status:'PENDING_AGENT_REVIEW',candidate_match:null,category:null,note:'Must be reviewed; deterministic extraction is not manual calibration.'});if(items.length>=limit)break;}
  return {scope:'ACTUAL_SOURCE_QUOTE_CALIBRATION_TOOLKIT',user_manual_calibration_completed:false,items};
}
export async function saveAgentCalibrationLabel(repository,label) {
  const job=(await repository.pool.query('SELECT description_text FROM jobs WHERE job_id=$1',[label.job_id])).rows[0];
  if(!job?.description_text.includes(label.source_quote)||label.author_type!=='ASSISTANT_AGENT'||label.review_status!=='AGENT_REVIEWED_USER_PENDING'||label.review_method!=='ASSISTANT_MANUAL_REVIEW')throw new Error('INVALID_AGENT_CALIBRATION_LABEL');
  await repository.pool.query(`INSERT INTO fit_calibration_labels(label_id,job_id,source_quote,quote_hash,source_url,label_json,author_type,review_status)
    VALUES($1,$2,$3,$4,$5,$6,'ASSISTANT_AGENT','AGENT_REVIEWED_USER_PENDING') ON CONFLICT(job_id,quote_hash,author_type) DO UPDATE SET label_json=EXCLUDED.label_json`,
    [randomUUID(),label.job_id,label.source_quote,hash(label.source_quote),label.source_url,label]);
}
export function compareCalibrationLabel(label,analysis) {
  const rows=analysis?.requirements?.filter(row=>row.source_quote===label.source_quote)??[];
  if(rows.length!==1)return{status:'EXACT_REQUIREMENT_NOT_MAPPED',observed_match:null,error_signals:['EXTRACTION_COVERAGE_GAP']};
  const row=rows[0];const signals=[];
  if(row.match!==label.candidate_match)signals.push('MATCH_DISAGREEMENT');
  if(row.importance!==label.importance)signals.push('IMPORTANCE_DISAGREEMENT');
  if(row.category!==label.category)signals.push('CATEGORY_DISAGREEMENT');
  if(['NO','UNKNOWN'].includes(label.candidate_match)&&row.match==='YES')signals.push('UNSUPPORTED_POSITIVE_MATCH_RISK');
  if(label.candidate_match==='YES'&&row.match==='NO'&&row.strict&&row.importance==='MANDATORY')signals.push('FALSE_HARD_BLOCKER_RISK');
  return{status:signals.length?'REVIEW_DISAGREEMENT':'AGREEMENT',observed_match:row.match,observed_importance:row.importance,
    observed_category:row.category,error_signals:signals};
}
