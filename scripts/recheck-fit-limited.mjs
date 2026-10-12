import {randomUUID,createHash} from 'node:crypto';import {readFile,writeFile,mkdir} from 'node:fs/promises';import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';import {routeAnalysis,deterministicHardReject} from '../services/core/fit.mjs';import {fastWorkFormat} from '../services/core/fit-fast.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8')),policy=YAML.parse(await readFile('config/search_policy.yaml','utf8'));
const repository=new Repository(process.env.DATABASE_URL,{max:2}),reader=await repository.pool.connect();
const report={started_at:new Date().toISOString(),score_method:'Previously recorded model score retained; current location and mandatory gates rechecked',checked:0,changed:0,accepted:0,location_pending:0,rejected:0,decisions:{},examples:[]};
try{
 await reader.query('BEGIN');await reader.query(`DECLARE fit_audit NO SCROLL CURSOR FOR SELECT j.*,a.analysis_id,a.analysis_json,a.model,a.profile_version FROM jobs j JOIN LATERAL(SELECT * FROM job_analysis WHERE job_id=j.job_id ORDER BY created_at DESC,analysis_id DESC LIMIT 1)a ON true WHERE a.analysis_json->>'profile_hash'=$1 AND a.analysis_json->>'policy_hash'=$2 AND a.analysis_json->>'job_content_hash'=j.content_hash`,[hash(profile),hash(policy)]);
 while(true){const rows=(await reader.query('FETCH 200 FROM fit_audit')).rows;if(!rows.length)break;const changes=[];
  for(const job of rows){report.checked++;const old=job.analysis_json;
   const hard=deterministicHardReject({job,profile,policy});
   const revised=hard??routeAnalysis({job,profile,policy,analysis:{...old,work_format:fastWorkFormat(job)},score:{overall_fit:old.overall_fit,scored_requirements:old.requirements?.length??0,mandatory_unknown:old.mandatory_unknown??false}});
   // A previous qualification rejection is not reversed by a location-only audit.
   if(old.decision==='REJECT')revised.decision='REJECT';
   const pending=revised.decision!=='REJECT'&&revised.location_policy_status!=='COMPATIBLE';
   if(revised.decision==='REJECT')report.rejected++;else if(pending)report.location_pending++;else report.accepted++;
   report.decisions[revised.decision]=(report.decisions[revised.decision]??0)+1;
   if(old.decision!==revised.decision||old.decision!=='REJECT'&&(old.location_policy_status!==revised.location_policy_status||pending&&old.fit_complete!==false)){
    const analysis={...old,...revised,fit_complete:!pending,cv_eligible:!pending&&revised.decision!=='REJECT',fit_status:pending?'NEEDS_LOCATION_EVIDENCE':revised.decision==='REJECT'?'REJECTED':'COMPLETE',fit_recheck_method:'DETERMINISTIC_LOCATION_AND_HARD_GATES',fit_rechecked_at:new Date().toISOString(),fit_recheck_parent_analysis_id:job.analysis_id,fit_score_reused:true};
    changes.push({analysis_id:randomUUID(),job_id:job.job_id,model:job.model,profile_version:job.profile_version,overall_fit:analysis.overall_fit,application_priority:analysis.application_priority??0,decision:analysis.decision,analysis_json:analysis,prompt_version:analysis.prompt_version,pending});report.changed++;
    if(report.examples.length<12)report.examples.push({job_id:job.job_id,title:job.title,old:old.decision,new:analysis.decision,geo:analysis.location_policy_status});
   }
  }
  if(changes.length){await repository.pool.query(`INSERT INTO job_analysis(analysis_id,job_id,model,profile_version,overall_fit,application_priority,decision,analysis_json,prompt_version) SELECT analysis_id,job_id,model,profile_version,overall_fit,application_priority,decision,analysis_json,prompt_version FROM jsonb_to_recordset($1::jsonb) AS t(analysis_id uuid,job_id uuid,model text,profile_version text,overall_fit numeric,application_priority numeric,decision text,analysis_json jsonb,prompt_version text)`,[JSON.stringify(changes)]);
   await repository.pool.query(`UPDATE relevance_queue q SET status=CASE WHEN t.pending THEN 'OPEN_UNVERIFIED' ELSE 'ANALYZED' END,error_code=CASE WHEN t.pending THEN 'FIT_LOCATION_EVIDENCE_REQUIRED' ELSE 'FIT_RECHECKED' END,next_retry_at=CASE WHEN t.pending THEN now()+interval '6 hours' ELSE NULL END FROM jsonb_to_recordset($1::jsonb) AS t(job_id uuid,pending boolean) WHERE q.job_id=t.job_id`,[JSON.stringify(changes)]);
  }
 }
 await reader.query('COMMIT');report.finished_at=new Date().toISOString();await mkdir('data/acceptance',{recursive:true});await writeFile('data/acceptance/fit-recheck.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await reader.query('ROLLBACK').catch(()=>{});reader.release();await repository.close();}
