import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {OllamaClient} from '../services/core/llm.mjs';
import {observedCvAnalysis} from './cv-v2-observed.mjs';
import {reverifyMarketJob} from '../services/core/discovery-v2.mjs';
import {fitInputHash} from '../services/core/relevance-queue.mjs';

if(process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT!=='false')throw new Error('Submission-disabled real dry-run required');
const repository=new Repository();const llm=new OllamaClient();
const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));
const policy=YAML.parse(await readFile('config/search_policy.yaml','utf8'));
const ids=(process.argv[2]??'8991663a-bb95-5105-b8fd-933fc49088c1,8505920f-0845-5f8b-9b54-cf0e4f8b81b7,c43179eb-f821-5fd4-b3be-42fd84d45f7f').split(',');
const reportPath='tests/results/cv-gate-fit.json';let report={scope:'REAL_REVIEW_TARGET_SELECTION',started_at:new Date().toISOString(),real_employer_submissions:0,model:llm.model,samples:[]};
try{report=JSON.parse(await readFile(reportPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir('tests/results',{recursive:true});const save=()=>writeFile(reportPath,JSON.stringify(report,null,2));
try {
  for(const id of ids.slice(0,5)) {
    const job=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[id])).rows[0];
    const sample={job_id:id,title:job?.title,company:job?.company,url:job?.canonical_url,started_at:new Date().toISOString()};report.samples.push(sample);await save();
    console.log(JSON.stringify({event:'gate_fit_started',job_id:id,title:job?.title}));
    try {
      if(!job)throw new Error('Actual discovered vacancy missing');
      sample.open_verification=await reverifyMarketJob({job,repository});
      if(sample.open_verification.status!=='OPEN')throw new Error('Actual posting not reverified OPEN');
      const refreshed=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[id])).rows[0];
      if(!refreshed.description_text||refreshed.description_text.length<100)throw new Error('Employer detail still missing');
      const observed=await observedCvAnalysis({repository,job:refreshed,profile,policy,llm});
      const analysis=observed.analysis;analysis.model=llm.model;analysis.profile_version=createHash('sha256').update(JSON.stringify(profile)).digest('hex');
      analysis.profile_hash=analysis.profile_version;analysis.job_content_hash=refreshed.content_hash;
      analysis.fit_input_hash=fitInputHash({job:refreshed,profile,policy,model:llm.model,promptVersion:analysis.prompt_version});
      await repository.saveAnalysis(id,analysis);sample.analysis=analysis;sample.operation_run_id=observed.operation_run_id;
      sample.review_candidate=['REVIEW','STRETCH'].includes(analysis.decision)&&analysis.overall_fit!=null&&analysis.requirements.length>0;
      sample.status=sample.review_candidate?'AWAITING_OPERATOR_SUITABILITY_REVIEW':analysis.decision;
      console.log(JSON.stringify({event:'gate_fit_completed',job_id:id,decision:analysis.decision,fit:analysis.overall_fit,requirements:analysis.requirements.length,review_candidate:sample.review_candidate,reasons:analysis.reasons}));
    }catch(error){sample.status='BLOCKED';sample.error=error.message;console.log(JSON.stringify({event:'gate_fit_blocked',job_id:id,error:error.message}));}
    sample.completed_at=new Date().toISOString();await save();
  }
}finally{report.completed_at=new Date().toISOString();await save();await repository.close();}
