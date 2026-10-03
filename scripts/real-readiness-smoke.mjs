import {readFile,writeFile,mkdir} from 'node:fs/promises';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {runDiscoverySmoke} from './discovery-smoke.mjs';
import {analyzeJob} from '../services/core/fit.mjs';
import {OllamaClient} from '../services/core/llm.mjs';
import {createCv} from '../services/core/cv.mjs';
const repo=new Repository();
const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));
const policy=YAML.parse(await readFile('config/search_policy.yaml','utf8'));
const llm=new OllamaClient();
const report={started_at:new Date().toISOString(),status:'PARTIAL',dry_run:true,allow_real_submit:false,real_applications:0,samples:[],limitations:[]};
if(process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT==='true')throw new Error('Real smoke requires DRY_RUN=true and ALLOW_REAL_SUBMIT=false');
try{
 await repo.migrate();
 report.discovery=await runDiscoverySmoke({repository:repo});
 const jobs=await repo.listCanonicalJobs();
 const priority=title=>/mechanical|mechatronic/i.test(title)?30:/intern|graduate|junior/i.test(title)?20:/support|python|data/i.test(title)?15:0;
 for(const source of report.discovery.sources){
  const ids=new Set((await repo.pool.query('SELECT job_id FROM job_sources WHERE source_name=$1',[source.source_name])).rows.map(r=>r.job_id));
  const candidates=jobs.filter(j=>ids.has(j.job_id)&&j.availability_status==='OPEN').sort((a,b)=>priority(b.title)-priority(a.title)||a.title.localeCompare(b.title));
  const job=candidates[0];if(!job){report.samples.push({source:source.source_name,error:'No open sample'});continue;}
  const sample={source:source.source_name,url:job.canonical_url,title:job.title,company:job.company,availability_status:'OPEN',verification_method:'Current official ATS published-job feed',verified_at:new Date().toISOString()};
  await repo.pool.query('UPDATE jobs SET last_verified_open_at=now() WHERE job_id=$1',[job.job_id]);
  try{const start=performance.now();const analysis=await analyzeJob({job,profile,policy,llm});analysis.model=llm.model;analysis.profile_version=profile.profile_version??'real-seed-v2';await repo.saveAnalysis(job.job_id,analysis);Object.assign(sample,{role_family:analysis.role_family,decision:analysis.decision,overall_fit:analysis.overall_fit,reasons:analysis.reasons,requirements:analysis.requirements.length,elapsed_ms:Math.round(performance.now()-start)});}
  catch(error){sample.error=error.message;}
  report.samples.push(sample);console.log(JSON.stringify({source:sample.source,title:sample.title,decision:sample.decision,error:sample.error}));
 }
 const name=profile.onboarding?.legal_name??profile.candidate?.legal_name;
 if(!name||name==='UNKNOWN'){report.cv={status:'BLOCKED',reason:'Real candidate legal name UNKNOWN. No fixture identity or placeholder substituted.'};report.limitations.push('Real CV QA requires the candidate legal name from onboarding.');}
 else{
  const sample=report.samples.find(s=>!s.error&&s.decision!=='REJECT');
  if(sample){const job=jobs.find(j=>j.canonical_url===sample.url);const analysis=(await repo.pool.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[job.job_id])).rows[0].analysis_json;try{report.cv={status:'PASS',manifest:await createCv({job,profile,analysis,repository:repo})};}catch(error){report.cv={status:'FAIL',reason:error.message};}}
  else report.cv={status:'BLOCKED',reason:'No eligible validated sample for tailored CV'};
 }
 const families=new Set(report.samples.filter(s=>!s.error).map(s=>s.role_family));report.role_families=[...families];
 if(report.discovery.status==='DISCOVERY_NORMALIZATION_PASS'&&report.samples.every(s=>!s.error)&&families.size>=2&&report.cv.status==='PASS')report.status='PASS';
 report.limitations.push('Feed verification proves current publication, not a browser fill or real employer submission.');
}catch(error){report.error=error.message;report.status='FAIL';}
finally{
 report.completed_at=new Date().toISOString();await mkdir('tests/results',{recursive:true});await writeFile('tests/results/real-readiness-smoke.json',JSON.stringify(report,null,2));
 const rows=report.samples.map(s=>`| ${s.source} | ${s.title} | ${s.availability_status??'UNKNOWN'} | ${s.decision??'FAILED'} | ${s.overall_fit??'N/A'} | ${s.error??''} |`);
 await writeFile('docs/REAL_DISCOVERY_SMOKE_REPORT.md',`# Real discovery readiness smoke\n\nOVERALL: ${report.status}\n\nStart: ${report.started_at}. End: ${report.completed_at}. Real submissions: 0.\n\nThree configured official ATS adapters were fetched with public GET-only network guards and PostgreSQL normalization. Discovered: ${report.discovery?.discovered??0}. Sources: ${report.discovery?.sources?.map(s=>`${s.source_name}=${s.discovered}`).join(', ')??'unavailable'}. Model: ${llm.model}; real local Ollama, real candidate facts, no test gateway.\n\n| Source | Sample role | Current feed state | Routing | Fit | Failure |\n|---|---|---|---|---:|---|\n${rows.join('\n')}\n\n${report.samples.map(s=>`- ${s.title}: ${s.url}`).join('\n')}\n\nCV: ${report.cv?.status??'not run'}. ${report.cv?.reason??''}\n\n${report.limitations.map(s=>'- '+s).join('\n')}\n\nDetailed evidence: tests/results/real-readiness-smoke.json. Run: node --env-file=.env scripts/real-readiness-smoke.mjs.\n`);
 await repo.close();console.log(JSON.stringify({status:report.status,samples:report.samples.length,cv:report.cv?.status}));
}
