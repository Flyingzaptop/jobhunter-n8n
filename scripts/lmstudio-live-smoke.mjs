import {readFile,mkdir,writeFile} from 'node:fs/promises';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {OllamaClient} from '../services/core/llm.mjs';
import {analyzeJob,sourceFragmentCatalog} from '../services/core/fit.mjs';
import {withExclusiveLocalGpu} from '../services/core/gpu-lock.mjs';
const repository=new Repository();
const report={provider:'lmstudio',started_at:new Date().toISOString(),scope:'REAL_VACANCY_VALIDATION_ONLY',analysis_rows_modified:0,real_employer_submissions:0,samples:[]};
try{
 const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));
 const policy=YAML.parse(await readFile('config/search_policy.yaml','utf8'));
 const llm=new OllamaClient();
 if(llm.provider!=='lmstudio'||!(await llm.health()).ok)throw new Error('LM Studio configured model unavailable');
 report.model=llm.model;report.model_timeout_ms=llm.timeoutMs;
 await mkdir('tests/results',{recursive:true});
 await writeFile('tests/results/lmstudio-live-smoke.json',JSON.stringify({...report,status:'RUNNING'},null,2),{mode:0o600});
 for(const jobId of ['221e87ec-35c0-5009-9cb1-8f4205b4f06a','5924fd0d-762b-5e90-86a9-b52ac31db65c']){
  const row=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[jobId])).rows[0];
  if(!row?.description_text)throw new Error('Actual vacancy text required');
  const started=Date.now();
  try{
   const job={...row.metadata,...row};
   const expected=sourceFragmentCatalog(job).filter(x=>x.importance_hint&&!x.list_container&&!x.context_only&&!x.work_format_only);
   const analysis=await withExclusiveLocalGpu(repository,()=>analyzeJob({job,profile,policy,llm}));
   const covered=expected.every(x=>analysis.requirements.some(r=>r.source_quote===x.text));
   const quality=covered&&analysis.requirements.length>0&&analysis.overall_fit!==null;
   report.samples.push({job_id:jobId,company:row.company,title:row.title,status:quality?'PASS':'INCOMPLETE_REQUIREMENT_COVERAGE',expected_explicit_requirements:expected.length,complete_source_coverage:covered,elapsed_ms:Date.now()-started,decision:analysis.decision,overall_fit:analysis.overall_fit,requirement_count:analysis.requirements.length,analysis,runtime_statistics:llm.lastStats});
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
