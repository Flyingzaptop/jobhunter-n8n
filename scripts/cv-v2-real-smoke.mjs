import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {OllamaClient} from '../services/core/llm.mjs';
import {observedCvAnalysis,observedCvBuild} from './cv-v2-observed.mjs';
import {reverifyMarketJob,loadMarketSources} from '../services/core/discovery-v2.mjs';
import {safeFetch} from '../services/core/discovery.mjs';
import {descriptionContent} from '../services/core/normalization.mjs';

if(process.env.DRY_RUN!=='true' || process.env.ALLOW_REAL_SUBMIT!=='false') throw new Error('Real smoke requires DRY_RUN=true, ALLOW_REAL_SUBMIT=false');
const repository=new Repository();
const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));
const policy=YAML.parse(await readFile('config/search_policy.yaml','utf8'));
const llm=new OllamaClient();
const targets=process.argv[2]?.split(',') ?? [
  '20188939-cda0-5e44-9f84-314b44951097', // RIVR junior mechanical, Switzerland
  '7eacc682-d769-5edd-96d4-537ee4d06e7b', // Bosch working student automation, EU
  'a5a56594-5084-5084-9358-4adebcac402c', // Bosch junior data scientist, EU
  'b083e564-e351-570a-b11c-5ab752d7f190', // Waymo simulation intern, Warsaw
  'a4c6c2d6-9b18-5bab-baf7-424b936caf43', // ALTEN junior CAD, France
  'a4a99775-88ed-5124-9a2e-a53fd9168aad', // Planet working student technical services, Berlin
  'cdf158ca-2373-565a-8feb-f46fedf1182b', // RIVR junior electronics, Switzerland
  '4a56d8a3-ba42-5d77-9999-b9cb0df08b85', // Canonical Python hardware certification, EMEA
];
let report={scope:'REAL_WORLD_TESTS',status:'RUNNING',started_at:new Date().toISOString(),fast_model:llm.model,strong_model:llm.strongModel,
  profile_sha256:createHash('sha256').update(JSON.stringify(profile)).digest('hex'),real_employer_submissions:0,
  selection:'Publicly discovered actual junior/working-student/engineering roles, prioritizing Europe/Poland and multiple target families. No injected fit scores or facts.',
  samples:[],limitations:['Missing real candidate identity blocks every submission-ready PDF. Rejected listings are retained as analysis evidence and never added to the application queue.']};
if(process.argv.includes('--append')) {report=JSON.parse(await readFile('tests/results/cv-v2-real.json','utf8'));report.status='RUNNING';report.rerun_started_at=new Date().toISOString();}
await mkdir('tests/results',{recursive:true});
const save=()=>writeFile('tests/results/cv-v2-real.json',JSON.stringify(report,null,2));
await save();
try {
  await repository.migrate();
  const sources=await loadMarketSources();
  const families=new Set();
  for (const id of targets.slice(0,9)) {
    const job=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[id])).rows[0];
    if(!job) {report.samples.push({job_id:id,error:'ACTUAL_JOB_NOT_FOUND'});await save();continue;}
    const sample={job_id:id,title:job.title,company:job.company,url:job.canonical_url,location:job.location,started_at:new Date().toISOString()};report.samples.push(sample);
    console.log(JSON.stringify({event:'sample_started',...sample}));await save();
    try {
      sample.open_verification=await reverifyMarketJob({job,repository});
      if(sample.open_verification.status!=='OPEN') {sample.status='BLOCKED_OPEN_VERIFICATION';continue;}
      job.availability_status='OPEN';
      // Summary feeds are NOT a complete vacancy. Hydrate the actual employer
      // public detail for selected processing only, without making up requirements.
      if(!job.description_text) {
        const mappings=(await repository.pool.query('SELECT * FROM job_sources WHERE job_id=$1',[id])).rows;
        const mapping=mappings.find(m=>sources.some(s=>s.name===m.source_name && s.adapter==='smartrecruiters'));
        const source=sources.find(s=>s.name===mapping?.source_name);
        if(!source) throw new Error('ACTUAL_DESCRIPTION_MISSING');
        const endpoint=`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.board)}/postings/${encodeURIComponent(mapping.source_item_id)}`;
        const response=await safeFetch(endpoint,source);const detail=JSON.parse(response.text);
        job.description_text=Object.entries(detail.jobAd?.sections??{}).map(([key,s])=>`${s.title??key}\n${descriptionContent(s.text??'')}`).join('\n');
        if(job.description_text.length<100) throw new Error('ACTUAL_DESCRIPTION_MISSING');
        job.content_hash=createHash('sha256').update(job.description_text).digest('hex');
        await repository.pool.query('UPDATE jobs SET description_text=$2,content_hash=$3,metadata=metadata || $4::jsonb WHERE job_id=$1',[id,job.description_text,job.content_hash,JSON.stringify({description_status:'OFFICIAL_DETAIL_FETCHED',detail_url:endpoint})]);
        sample.description_source=endpoint;
      }
      sample.description_characters=job.description_text.length;
      const observed=await observedCvAnalysis({repository,job,profile,policy,llm});sample.analysis=observed.analysis;sample.analysis_operation_run_id=observed.operation_run_id;sample.analysis.model=llm.model;sample.analysis.profile_version=profile.profile_version??report.profile_sha256;
      await repository.saveAnalysis(id,sample.analysis);
      sample.decision=sample.analysis.decision;sample.overall_fit=sample.analysis.overall_fit;sample.role_family=sample.analysis.role_family;
      console.log(JSON.stringify({event:'analysis_complete',job_id:id,decision:sample.decision,overall_fit:sample.overall_fit,role_family:sample.role_family}));await save();
      if(sample.decision==='REJECT') {sample.status='REJECTED_BY_REAL_FIT';continue;}
      if(!sample.analysis.requirements.length || sample.overall_fit===null) {sample.status='REVIEW_INFORMATION_INCOMPLETE';continue;}
      sample.pre_cv_open_verification=await reverifyMarketJob({job,repository});
      if(sample.pre_cv_open_verification.status!=='OPEN') {sample.status='BLOCKED_PRE_CV_OPEN_VERIFICATION';continue;}
      sample.cv=await observedCvBuild({job,profile,analysis:sample.analysis,llm,repository,outputRoot:'data/cv-v2-real'});
      sample.status=sample.cv.status;
      if(sample.cv.qa.claims.pass) families.add(sample.role_family);
      console.log(JSON.stringify({event:'cv_complete',job_id:id,cv_id:sample.cv.cv_id,status:sample.status,claims_pass:sample.cv.qa.claims.pass}));
      if(families.size>=3) break;
    } catch(error) {sample.status='FAILED';sample.error=error.message;console.log(JSON.stringify({event:'sample_failed',job_id:id,error:error.message}));}
    finally {sample.completed_at=new Date().toISOString();await save();}
  }
  report.content_fact_qa_pass=report.samples.filter(s=>s.cv?.qa.claims.pass).length;
  report.distinct_factually_verified_cv_role_families=[...families];
  report.full_pdf_pass=report.samples.filter(s=>s.cv?.qa.pass).length;
  report.status=report.full_pdf_pass>=3 ? 'PASS' : 'PARTIAL';
} catch(error) {report.status='FAIL';report.error=error.message;}
finally {report.completed_at=new Date().toISOString();await save();await repository.close();console.log(JSON.stringify({event:'real_cv_smoke_finished',status:report.status,content_fact_qa_pass:report.content_fact_qa_pass,full_pdf_pass:report.full_pdf_pass}));}
