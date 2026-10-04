import {readFile,mkdir,writeFile} from 'node:fs/promises';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {OllamaClient} from '../services/core/llm.mjs';
import {buildRelevanceQueue,listRelevanceCandidates,runRelevanceFitBatch,createCalibrationPack} from '../services/core/relevance-queue.mjs';

const repository=new Repository();const value=prefix=>process.argv.find(arg=>arg.startsWith(prefix))?.slice(prefix.length);
try {
  if(!process.argv.includes('--status')){await repository.migrate();await mkdir('tests/results',{recursive:true});}
  if(process.argv.includes('--status')) {
    const run=(await repository.pool.query("SELECT * FROM operation_runs WHERE trigger='relevance-queue' AND mode='REAL' ORDER BY started_at DESC LIMIT 1")).rows[0];
    const counts=(await repository.pool.query('SELECT status,count(*)::int count FROM relevance_queue GROUP BY status ORDER BY status')).rows;
    const results=run?(await repository.pool.query(`SELECT j.job_id,j.title,j.company,j.location,a.decision,a.overall_fit,
      jsonb_array_length(a.analysis_json->'requirements') requirement_count,f.completed_at
      FROM fit_batch_receipts f JOIN jobs j USING(job_id) JOIN job_analysis a ON a.analysis_id=f.analysis_id WHERE f.run_id=$1 ORDER BY f.completed_at`,[run.run_id])).rows:[];
    console.log(JSON.stringify({run:run?{run_id:run.run_id,status:run.status,message:run.message,processed:run.processed_count,success:run.success_count,failure:run.failure_count,started_at:run.started_at}:null,
      queue:counts,analyzed:results.length,decisions:results.reduce((a,j)=>{a[j.decision]=(a[j.decision]??0)+1;return a;},{}),nonreject:results.filter(j=>j.decision!=='REJECT')}));
  }else if(process.argv.includes('--analyze')) {
    if(process.env.JOBHUNTER_FIT_BATCH_AUTHORIZED!=='true')throw new Error('Root must grant exclusive GPU ownership before batch inference');
    if(process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT!=='false')throw new Error('Readiness batch requires real submit disabled');
    const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));
    const policy=YAML.parse(await readFile('config/search_policy.yaml','utf8'));
    const report=await runRelevanceFitBatch({repository,profile,policy,llm:new OllamaClient(),
      inferenceAuthorized:true,maxJobs:Number(value('--max-jobs=')??25),maxRuntimeMs:Number(value('--max-minutes=')??60)*60000});
    await writeFile(`tests/results/fit-batch-${report.operation_run_id}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }else {
    const report=await buildRelevanceQueue({repository,observer:event=>console.log(JSON.stringify(event))});
    const candidates=await listRelevanceCandidates(repository,{limit:Number(value('--limit=')??500)});
    await writeFile('tests/results/relevance-queue-summary.json',JSON.stringify(report,null,2));
    await writeFile('tests/results/relevance-queue-candidates.json',JSON.stringify(candidates.map(j=>({job_id:j.job_id,title:j.title,company:j.company,
      canonical_url:j.canonical_url,location:j.location,country:j.country,relevance_score:j.relevance_score,role_hints:j.role_hints,reasons:j.reasons,
      seniority_class:j.seniority_class,location_class:j.location_class,needs_hydration:j.needs_hydration,queue_status:j.queue_status})),null,2));
    const calibration=await createCalibrationPack({repository,limit:20});
    await writeFile('tests/results/fit-calibration-review-pack.json',JSON.stringify(calibration,null,2));
    console.log(JSON.stringify({...report,selected:candidates.length,gpu_calls:0,fit_results_created:0}));
  }
}finally{await repository.close();}
