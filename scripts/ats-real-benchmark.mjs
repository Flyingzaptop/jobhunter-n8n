import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {BrowserClient,resolveField} from '../services/core/application.mjs';
import {atsAdapterFor,observerUrl,safeNavigationButton} from '../services/browser-service/ats-adapters.mjs';
import {runObserved,observe} from '../services/core/observability.mjs';
import {reverifyMarketJob,loadMarketSources,robotsAllows} from '../services/core/discovery-v2.mjs';
import {safeFetch} from '../services/core/discovery.mjs';

if(process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT!=='false')throw new Error('Dry-run lock required');
const repository=new Repository(),browser=new BrowserClient();
const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));
const report={scope:'REAL_WORLD_TESTS',started_at:new Date().toISOString(),real_employer_submissions:0,samples:[],status:'RUNNING'};
await mkdir('tests/results',{recursive:true});
const save=()=>writeFile('tests/results/ats-real-v2.json',JSON.stringify(report,null,2));
try{
 await repository.migrate();
 await runObserved(repository,5,{},async()=>{
  const jobs=await repository.listCanonicalJobs();
  for(const adapter of ['greenhouse','lever','ashby','smartrecruiters','teamtailor','workday']){
   const job=jobs.find(j=>atsAdapterFor(j.canonical_url)===adapter&&j.availability_status!=='CLOSED');
   const sample={benchmark_id:randomUUID(),adapter,job_id:job?.job_id??null,url:job?observerUrl(job.canonical_url):null,status:'UNAVAILABLE',fields:[],filled:[],uploaded:false,submitted:false};
   try{
    if(!job){sample.blocker='NO_DISCOVERED_OFFICIAL_POSTING';continue;}
    const verified=await reverifyMarketJob({job,repository});
    const {job:refreshedJob,...freshness}=verified;
    sample.freshness_verification=freshness;
    if(verified.status!=='OPEN'){sample.status='BLOCKED';sample.blocker='CURRENT_OFFICIAL_POSTING_NOT_VERIFIED_OPEN';continue;}
    await observe(repository,{event:'ATS_OPENING',entity_type:'job',entity_id:job.job_id,message:`Inspecting actual ${adapter} posting`});
    const opened=await browser.call('/sessions',{application_id:`ats-${sample.benchmark_id}`,url:job.canonical_url});
    sample.browser_session_id=opened.session_id;
    let view=opened.snapshot;
    // Teamtailor documents this public GET form URL for career-site embeds.
    // The posting was verified above; this never clicks its type=submit button.
    if(adapter==='teamtailor'&&!view.fields.some(f=>f.visible)){
      const target=new URL(job.canonical_url);
      if(/^\/jobs\/\d+-[^/]+\/?$/.test(target.pathname)){
        target.pathname=target.pathname.replace(/\/$/,'')+'/applications/new';
        target.search='';target.hash='';
        const source=(await loadMarketSources()).find(s=>s.adapter==='teamtailor_public_html'&&new URL(s.url).origin===target.origin);
        if(!source)throw new Error('PUBLIC_FORM_SOURCE_NOT_REGISTERED');
        const robots=await safeFetch(source.robots_url,source);
        if(!robotsAllows(robots.text,target.href))throw new Error('PUBLIC_FORM_ROBOTS_BLOCKED');
        sample.form_access_policy='ROBOTS_ALLOWED_PUBLIC_FORM';
        view=await browser.call(`/sessions/${opened.session_id}/navigate`,{url:target.href});
        sample.navigation_method='DOCUMENTED_PUBLIC_APPLICATION_FORM_GET';
      }
    }
    // Only same-origin reviewed GET navigation; no form submission or candidate-data POST.
    const navigation=view.buttons.find(button=>safeNavigationButton({adapter,url:view.url,button,fields:view.fields}));
    if(navigation)view=await browser.call(`/sessions/${opened.session_id}/click`,{selector:navigation.selector});
    sample.title=view.title;sample.url=observerUrl(view.url);sample.detected_adapter=view.adapter;
    sample.fields=view.fields.filter(f=>f.visible).map(({name,label,type,required})=>({name,label,type,required}));
    sample.blocked_requests=view.blocked_requests;
    if(view.captcha){sample.status='MANUAL_TAKEOVER';sample.blocker='CAPTCHA';}
    else if(!sample.fields.length){sample.status='PARTIAL';sample.blocker='APPLICATION_FORM_NOT_REACHED';}
    else{
     for(const field of view.fields.filter(f=>f.visible&&['text','email','tel','textarea'].includes(f.type))){
      const answer=resolveField(field,{profile,job});
      if(!answer||answer.value===undefined||answer.value===null||answer.value==='UNKNOWN')continue;
      // Limit to factual local contact/location fields; never motivation, legal attestation or free-form inference.
      if(!/^(city|country|first_name|last_name|email|phone)$/i.test(field.name))continue;
      await browser.call(`/sessions/${opened.session_id}/fill`,{selector:field.selector,value:answer.value});
      sample.filled.push({name:field.name,source:answer.source});
     }
     sample.status='PARTIAL';sample.blocker='REAL_IDENTITY_AND_SUBMISSION_READY_CV_MISSING';
    }
    await browser.call(`/sessions/${opened.session_id}/checkpoint`,{});
    sample.stop_reason='DRY_RUN_BEFORE_FINAL_SUBMIT';
   }catch(error){sample.status='BLOCKED';sample.blocker=error.message;}
   finally{
    report.samples.push(sample);
    await repository.pool.query('INSERT INTO ats_compatibility_runs(benchmark_id,adapter,job_id,browser_session_id,status,report_json) VALUES($1,$2,$3,$4,$5,$6)',[sample.benchmark_id,adapter,sample.job_id,sample.browser_session_id??null,sample.status,sample]);
    await save();
   }
  }
  return {blocked_reason:'ATS_COMPATIBILITY_PARTIAL',attempted:report.samples.length,results:report.samples};
 },{mode:'REAL',trigger:'real-ats-benchmark'});
 report.status='PARTIAL';report.completed_at=new Date().toISOString();await save();
 console.log(JSON.stringify(report.samples.map(({adapter,status,blocker,browser_session_id,fields,filled})=>({adapter,status,blocker,browser_session_id,fields:fields.length,filled:filled.length}))));
}finally{await repository.pool.end();}
