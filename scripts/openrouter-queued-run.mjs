import {readFile,mkdir,writeFile} from 'node:fs/promises';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {OllamaClient} from '../services/core/llm.mjs';
import {runRelevanceFitBatch} from '../services/core/relevance-queue.mjs';
if(process.env.JOBHUNTER_FIT_BATCH_AUTHORIZED!=='true'||process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT!=='false')throw new Error('Authorized dry-run required');
const repository=new Repository(),state={provider:'openrouter',started_at:new Date().toISOString(),inference_attempted:0,analyzed:0,rate_deferrals:0,status:'RUNNING',real_employer_submissions:0};
await mkdir('tests/results',{recursive:true});const save=()=>writeFile('tests/results/openrouter-continuation.json',JSON.stringify(state,null,2));
const until=Date.now()+45*60000;
try{
 while(Date.now()<until&&state.inference_attempted<15){
  if((await repository.pool.query('SELECT paused FROM runtime_control WHERE id=true')).rows[0]?.paused){state.status='PAUSED';break;}
  const client=new OllamaClient();if(client.provider!=='openrouter'||!client.model.endsWith(':free'))throw new Error('Verified free OpenRouter required');
  const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8')),policy=YAML.parse(await readFile('config/search_policy.yaml','utf8'));
  const result=await runRelevanceFitBatch({repository,profile,policy,llm:client,inferenceAuthorized:true,maxJobs:15-state.inference_attempted,maxRuntimeMs:Math.max(1000,until-Date.now())});
  state.model=client.model;state.latest_run_id=result.operation_run_id;state.inference_attempted+=result.inference_attempted??0;state.analyzed+=result.analyzed??0;state.latest_status=result.blocked_reason??'COMPLETED';
  await save();console.log(JSON.stringify(state));
  if(result.blocked_reason!=='PROVIDER_RATE_LIMIT'||++state.rate_deferrals>=3){state.status=result.blocked_reason??'COMPLETED';break;}
  state.status='WAITING_PROVIDER_RATE_LIMIT';await save();const retryAt=Math.max(Date.now()+300000,Date.parse(result.retry_at??'')||0);
  while(Date.now()<retryAt&&Date.now()<until){await new Promise(resolve=>setTimeout(resolve,5000));if((await repository.pool.query('SELECT paused FROM runtime_control WHERE id=true')).rows[0]?.paused){state.status='PAUSED';break;}}
  if(state.status==='PAUSED')break;state.status='RUNNING';
 }
 state.finished_at=new Date().toISOString();await save();console.log(JSON.stringify(state));
}finally{await repository.close();}
