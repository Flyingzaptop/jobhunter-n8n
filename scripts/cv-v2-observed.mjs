import {runObserved,observe} from '../services/core/observability.mjs';
import {analyzeJob} from '../services/core/fit.mjs';
import {buildTailoredCv} from '../services/core/cv-v2.mjs';

export async function observedCvAnalysis({repository,job,profile,policy,llm}) {
  let analysis;
  const operation=await runObserved(repository,3,{job_id:job.job_id},async()=>{
    await observe(repository,{event:'REAL_CV_SAMPLE_ANALYSIS_STARTED',entity_type:'job',entity_id:job.job_id,message:`Analyzing ${job.company} — ${job.title}`,model:llm.model});
    analysis=await analyzeJob({job,profile,policy,llm});
    await observe(repository,{event:'REAL_CV_SAMPLE_ANALYSIS_COMPLETED',entity_type:'job',entity_id:job.job_id,message:`${analysis.decision}: ${job.title}`,processed_count:1,success_count:1,model:llm.model,requirements:analysis.requirements.length,overall_fit:analysis.overall_fit});
    return {attempted:1,analyzed:1,job_id:job.job_id,decision:analysis.decision,overall_fit:analysis.overall_fit,prompt_version:analysis.prompt_version,model:llm.model,model_requests:llm.lastStats?.semantic_attempts};
  },{trigger:'real_cv_acceptance',mode:'REAL'});
  return {analysis,operation_run_id:operation.operation_run_id};
}

export async function observedCvBuild({repository,...args}) {
  let manifest;
  await runObserved(repository,4,{job_id:args.job.job_id},async()=>{
    await observe(repository,{event:'REAL_CV_SAMPLE_STARTED',entity_type:'job',entity_id:args.job.job_id,message:`Tailoring ${args.job.company} — ${args.job.title}`});
    manifest=await buildTailoredCv({...args,repository});
    await observe(repository,{event:'REAL_CV_SAMPLE_COMPLETED',entity_type:'cv',entity_id:manifest.cv_id,message:`${manifest.status}: ${args.job.title}`,processed_count:1,success_count:manifest.qa.claims.pass?1:0,failure_count:manifest.qa.claims.pass?0:1});
    return {generated:1,cv_id:manifest.cv_id,job_id:args.job.job_id,status:manifest.status,blocked_reason:manifest.qa.pass?null:manifest.status,
      model:manifest.model,verifier_model:manifest.verifier_model,claims_pass:manifest.qa.claims.pass,identity_pass:manifest.qa.identity.pass,pdf_pass:manifest.qa.pdf.pass};
  },{trigger:'real_cv_acceptance',mode:'REAL'});
  return manifest;
}
