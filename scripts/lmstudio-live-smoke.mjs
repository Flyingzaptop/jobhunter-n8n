import {readFile,mkdir,writeFile} from 'node:fs/promises';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {OllamaClient} from '../services/core/llm.mjs';
import {analyzeJob} from '../services/core/fit.mjs';
const repository=new Repository();
const report={provider:'lmstudio',started_at:new Date().toISOString(),scope:'REAL_VACANCY_VALIDATION_ONLY',analysis_rows_modified:0,real_employer_submissions:0,samples:[]};
try{
 const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));
 const policy=YAML.parse(await readFile('config/search_policy.yaml','utf8'));
 const llm=new OllamaClient();
 if(llm.provider!=='lmstudio'||!(await llm.health()).ok)throw new Error('LM Studio configured model unavailable');
 report.model=llm.model;
 for(const jobId of ['55f8b831-91dc-5b6b-a173-7c24d9e9f4ba','b083e564-e351-570a-b11c-5ab752d7f190']){
  const row=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[jobId])).rows[0];
  if(!row?.description_text)throw new Error('Actual vacancy text required');
  const started=Date.now();
  try{
   const analysis=await analyzeJob({job:{...row.metadata,...row},profile,policy,llm});
   report.samples.push({job_id:jobId,company:row.company,title:row.title,status:'PASS',elapsed_ms:Date.now()-started,decision:analysis.decision,overall_fit:analysis.overall_fit,requirement_count:analysis.requirements.length,analysis,runtime_statistics:llm.lastStats});
  }catch(error){report.samples.push({job_id:jobId,company:row.company,status:'FAILED',elapsed_ms:Date.now()-started,error_code:error.code??error.name,error_message:String(error.message).slice(0,180),runtime_statistics:llm.lastStats});}
  await mkdir('tests/results',{recursive:true});
  await writeFile('tests/results/lmstudio-live-smoke.json',JSON.stringify(report,null,2),{mode:0o600});
  const {analysis,...summary}=report.samples.at(-1);console.log(JSON.stringify(summary));
 }
 report.finished_at=new Date().toISOString();report.status=report.samples.every(x=>x.status==='PASS')?'PASS':'FAILED';
 await writeFile('tests/results/lmstudio-live-smoke.json',JSON.stringify(report,null,2),{mode:0o600});
 console.log(JSON.stringify({status:report.status,model:report.model,passed:report.samples.filter(x=>x.status==='PASS').length,total:report.samples.length}));
 if(report.status!=='PASS')process.exitCode=1;
}finally{await repository.close();}
