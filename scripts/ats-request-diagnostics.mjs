import {mkdir,writeFile} from 'node:fs/promises';
import {createBrowserService,browserConfig} from '../services/browser-service/server.mjs';
import {BrowserClient} from '../services/core/application.mjs';
import {Repository} from '../services/core/repository.mjs';
const repository=new Repository();const service=await createBrowserService({...browserConfig(),port:0,stateRoot:'data/browser-gate-debug',dryRun:true,allowRealSubmit:false});
try{
 await service.listen();const browser=new BrowserClient({baseUrl:`http://127.0.0.1:${service.server.address().port}`});
 const rows=(await repository.pool.query("SELECT job_id,canonical_url,title,company FROM jobs WHERE canonical_url LIKE 'https://jobs.ashbyhq.com/%' AND availability_status='OPEN' ORDER BY first_seen_at LIMIT 1")).rows;
 const report={scope:'REAL_PUBLIC_FORM_REQUEST_DIAGNOSTICS',real_employer_submissions:0,samples:[]};
 for(const job of rows){
  const opened=await browser.call('/sessions',{application_id:'gate-diagnostic-'+job.job_id});const publicReads=[];
  service.sessions.get(opened.session_id).context.on('request',request=>{
   try{const url=new URL(request.url());if(url.origin!=='https://jobs.ashbyhq.com'||url.pathname!=='/api/non-user-graphql'||request.method()!=='POST')return;const data=JSON.parse(request.postData());if(!['ApiJobPosting','ApiOrganizationFromHostedJobsPageName'].includes(data.operationName)||typeof data.query!=='string'||/^\s*mutation\b/i.test(data.query))return;publicReads.push(data);}catch{}
  });
  await browser.call(`/sessions/${opened.session_id}/navigate`,{url:job.canonical_url+'/application'});await new Promise(resolve=>setTimeout(resolve,3000));const snapshot=await browser.call(`/sessions/${opened.session_id}/snapshot`);report.samples.push({job_id:job.job_id,url:snapshot.url,title:snapshot.title,adapter:snapshot.adapter,visible_fields:snapshot.fields.filter(f=>f.visible).length,blocked_requests:snapshot.blocked_requests,public_reads:publicReads});await browser.call(`/sessions/${opened.session_id}`,undefined,'DELETE');
 }
 await mkdir('tests/results',{recursive:true});await writeFile('tests/results/ats-request-diagnostics.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await service.close();await repository.close();}
