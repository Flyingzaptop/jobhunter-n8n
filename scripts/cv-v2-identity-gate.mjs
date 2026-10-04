import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {OllamaClient} from '../services/core/llm.mjs';
import {cvIdentityQa} from '../services/core/cv-v2.mjs';
import {observedCvBuild} from './cv-v2-observed.mjs';
import {reverifyMarketJob} from '../services/core/discovery-v2.mjs';

if(process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT!=='false')throw new Error('Real CV gate requires submission-disabled dry-run');
const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));
if(!cvIdentityQa(profile).pass)throw new Error('Actual identity/contact QA not ready');
const repository=new Repository();const llm=new OllamaClient();
const ids=(process.argv[2]??'4a56d8a3-ba42-5d77-9999-b9cb0df08b85').split(',');
const reportPath='tests/results/cv-identity-gate.json';
let report={scope:'REAL_WORLD_IDENTITY_CV_GATE',started_at:new Date().toISOString(),status:'RUNNING',identity_qa_pass:true,real_employer_submissions:0,samples:[]};
try {report=JSON.parse(await readFile(reportPath,'utf8'));report.status='RUNNING';}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir('tests/results',{recursive:true});const save=()=>writeFile(reportPath,JSON.stringify(report,null,2));
try {
  for(const id of ids) {
    if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('Actual UUID required');
    const job=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[id])).rows[0];
    let analysis=(await repository.pool.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[id])).rows[0]?.analysis_json;
    const sample={job_id:id,title:job?.title,company:job?.company,url:job?.canonical_url,decision:analysis?.decision,overall_fit:analysis?.overall_fit,started_at:new Date().toISOString()};report.samples.push(sample);await save();
    try {
      if(!job||!analysis||!['REVIEW','STRETCH'].includes(analysis.decision)||analysis.overall_fit==null||!analysis.requirements?.length)throw new Error('Actual non-rejected information-complete REVIEW/STRETCH analysis required');
      if(/account(?:s)?\s+(?:payable|receivable)|remote\s*[-–]\s*us\b/i.test(`${job.title} ${job.location}`))throw new Error('Outside plausible technical/EU acceptance scope');
      sample.open_verification=await reverifyMarketJob({job,repository});
      if(sample.open_verification.status!=='OPEN')throw new Error('Posting not currently verified OPEN');
      const refreshed=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[id])).rows[0];
      analysis=(await repository.pool.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[id])).rows[0]?.analysis_json;
      const currentProfileHash=createHash('sha256').update(JSON.stringify(profile)).digest('hex');
      if(!analysis||analysis.profile_hash!==currentProfileHash||analysis.job_content_hash!==refreshed.content_hash||!analysis.fit_input_hash)throw new Error('Current source/profile-bound analysis receipt required; no legacy fallback');
      if(!['REVIEW','STRETCH'].includes(analysis.decision)||analysis.overall_fit==null||!analysis.requirements?.length||analysis.hard_blockers?.length)throw new Error('Latest source-bound analysis is not suitable for review');
      sample.cv=await observedCvBuild({job:refreshed,profile,analysis,llm,repository,outputRoot:'data/cv-v2'});
      sample.status=sample.cv.status;sample.pdf_visual_review='PENDING';
      console.log(JSON.stringify({event:'identity_cv_generated',job_id:id,cv_id:sample.cv.cv_id,status:sample.cv.status,claims_pass:sample.cv.qa.claims.pass,identity_pass:sample.cv.qa.identity.pass,pdf_pass:sample.cv.qa.pdf.pass,pages:sample.cv.qa.pdf.page_count,preview_paths:sample.cv.qa.pdf.preview_paths,error:sample.cv.qa.error}));
    }catch(error){sample.status='BLOCKED';sample.error=error.message;console.log(JSON.stringify({event:'identity_cv_blocked',job_id:id,error:error.message}));}
    sample.completed_at=new Date().toISOString();await save();
  }
  report.generated_pdf_pass=report.samples.filter(s=>s.cv?.qa.pass).length;
  report.status=report.generated_pdf_pass>=3?'PENDING_VISUAL_QA':'PARTIAL';
}finally{report.completed_at=new Date().toISOString();await save();await repository.close();}
