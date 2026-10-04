import {readFile,writeFile} from 'node:fs/promises';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {OllamaClient} from '../services/core/llm.mjs';
import {observedCvAnalysis,observedCvBuild} from './cv-v2-observed.mjs';
import {reverifyMarketJob} from '../services/core/discovery-v2.mjs';

if(process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT!=='false')throw new Error('Dry-run only');
const repository=new Repository();const llm=new OllamaClient();
const cvModelArg=process.argv.find(arg=>arg.startsWith('--cv-model='))?.slice('--cv-model='.length);
const cvLlm=new OllamaClient({model:process.env.CV_VERIFIER_MODEL??cvModelArg??llm.model,strongModel:process.env.CV_WRITER_MODEL??cvModelArg??llm.strongModel});
const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));
const policy=YAML.parse(await readFile('config/search_policy.yaml','utf8'));
const report=JSON.parse(await readFile('tests/results/cv-v2-real.json','utf8'));
const save=()=>writeFile('tests/results/cv-v2-real.json',JSON.stringify(report,null,2));
report.diagnostic_attempts=[...(report.diagnostic_attempts??[]),...(report.diagnostic_content??[])];
report.diagnostic_content=[];
report.cv_model_evaluations=[...(report.cv_model_evaluations??[]),{writer_model:cvLlm.strongModel,verifier_model:cvLlm.model,started_at:new Date().toISOString()}];
try {
  // Retry the actual non-rejected Python sample after fixing the verified YAML
  // skill-map normalization. Reuse its saved genuine model analysis unchanged.
  const pythonId='4a56d8a3-ba42-5d77-9999-b9cb0df08b85';
  const pythonJob=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[pythonId])).rows[0];
  const pythonAnalysis=(await repository.pool.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[pythonId])).rows[0]?.analysis_json;
  const pythonSample=report.samples.filter(s=>s.job_id===pythonId).at(-1);
  if(pythonJob && pythonAnalysis?.decision!=='REJECT' && pythonAnalysis?.requirements?.length && pythonAnalysis?.overall_fit!=null) {
    try {
      pythonSample.previous_cv_error=pythonSample.error;delete pythonSample.error;
      pythonSample.pre_cv_open_verification=await reverifyMarketJob({job:pythonJob,repository});
      if(pythonSample.pre_cv_open_verification.status!=='OPEN')throw new Error('Real Python vacancy no longer OPEN');
      pythonSample.cv=await observedCvBuild({job:pythonJob,profile,analysis:pythonAnalysis,llm:cvLlm,repository,outputRoot:'data/cv-v2-real'});pythonSample.status=pythonSample.cv.status;
      console.log(JSON.stringify({event:'python_cv_complete',job_id:pythonId,cv_id:pythonSample.cv.cv_id,status:pythonSample.status,claims_pass:pythonSample.cv.qa.claims.pass,error:pythonSample.cv.qa.error}));
    }catch(error){pythonSample.status='FAILED';pythonSample.error=error.message;}
    await save();
  }
  // Ninth representative fit sample: an actual entry-level professional IT role.
  const job=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',['fca8777c-e5b4-5044-94e1-dd50174a8b78'])).rows[0];
  if(job && !process.argv.includes('--skip-it')) {
    const sample={job_id:job.job_id,title:job.title,company:job.company,url:job.canonical_url,location:job.location,started_at:new Date().toISOString()};report.samples.push(sample);await save();
    try {
      sample.open_verification=await reverifyMarketJob({job,repository});
      if(sample.open_verification.status!=='OPEN')sample.status='BLOCKED_OPEN_VERIFICATION';
      else {
        const observed=await observedCvAnalysis({repository,job,profile,policy,llm});sample.analysis=observed.analysis;sample.analysis_operation_run_id=observed.operation_run_id;sample.analysis.model=llm.model;sample.analysis.profile_version=report.profile_sha256;
        await repository.saveAnalysis(job.job_id,sample.analysis);Object.assign(sample,{decision:sample.analysis.decision,overall_fit:sample.analysis.overall_fit,role_family:sample.analysis.role_family});
        if(sample.decision==='REJECT')sample.status='REJECTED_BY_REAL_FIT';
        else if(!sample.analysis.requirements.length || sample.overall_fit===null)sample.status='REVIEW_INFORMATION_INCOMPLETE';
        else {sample.pre_cv_open_verification=await reverifyMarketJob({job,repository});if(sample.pre_cv_open_verification.status==='OPEN')sample.cv=await observedCvBuild({job,profile,analysis:sample.analysis,llm:cvLlm,repository,outputRoot:'data/cv-v2-real'});sample.status=sample.cv?.status??'BLOCKED_PRE_CV_OPEN_VERIFICATION';}
      }
    }catch(error){sample.status='FAILED';sample.error=error.message;}
    sample.completed_at=new Date().toISOString();console.log(JSON.stringify({event:'it_sample_complete',job_id:job.job_id,status:sample.status,fit:sample.overall_fit,decision:sample.decision}));await save();
  }
  // These are rejected actual jobs. They test factual writing across real target
  // contexts ONLY and are explicitly excluded from suitable-CV acceptance.
  for(const [id,targetContext] of [['20188939-cda0-5e44-9f84-314b44951097','MECHANICAL_R_AND_D'],['7eacc682-d769-5edd-96d4-537ee4d06e7b','TEST_AUTOMATION'],['a5a56594-5084-5084-9358-4adebcac402c','DATA_SCIENCE']]) {
    const job=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[id])).rows[0];
    const analysis=(await repository.pool.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[id])).rows[0]?.analysis_json;
    const sample={job_id:id,title:job.title,company:job.company,url:job.canonical_url,target_context:targetContext,source_decision:analysis?.decision,application_eligible:false,acceptance_scope:'REJECTED_DIAGNOSTIC_CONTENT_ONLY',started_at:new Date().toISOString()};report.diagnostic_content.push(sample);await save();
    try {
      if(analysis?.decision!=='REJECT')throw new Error('Diagnostic requires actual stored REJECT, never injected routing');
      sample.pre_cv_open_verification=await reverifyMarketJob({job,repository});
      if(sample.pre_cv_open_verification.status!=='OPEN')throw new Error('Real vacancy no longer OPEN');
      sample.cv=await observedCvBuild({job,profile,analysis,llm:cvLlm,repository,outputRoot:'data/cv-v2-real-diagnostics'});
      sample.status=sample.cv.status;
      console.log(JSON.stringify({event:'diagnostic_cv_complete',job_id:id,cv_id:sample.cv.cv_id,status:sample.status,claims_pass:sample.cv.qa.claims.pass,error:sample.cv.qa.error}));
    }catch(error){sample.status='FAILED';sample.error=error.message;console.log(JSON.stringify({event:'diagnostic_cv_failed',job_id:id,error:error.message}));}
    sample.completed_at=new Date().toISOString();await save();
  }
  report.content_fact_qa_pass=report.samples.filter(s=>s.cv?.qa.claims.pass).length;
  report.full_pdf_pass=report.samples.filter(s=>s.cv?.qa.pass).length;
  report.diagnostic_fact_qa_pass=report.diagnostic_content.filter(s=>s.cv?.qa.claims.pass).length;
  report.distinct_factually_verified_cv_role_families=[...new Set(report.samples.filter(s=>s.cv?.qa.claims.pass).map(s=>s.role_family))];
  report.status=report.full_pdf_pass>=3?'PASS':'PARTIAL';
  report.limitations.push('Rejected diagnostic drafts prove factual writer/verifier behavior only. They count as zero suitable-CV acceptance and cannot become employer applications.');
}finally{report.completed_at=new Date().toISOString();await save();await repository.close();}
