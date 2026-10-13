import fs from 'node:fs/promises';
import {Repository} from '../services/core/repository.mjs';
import {BrowserClient} from '../services/core/application.mjs';
import {classifyLiveVacancy} from '../services/core/vacancy-live-check.mjs';
const repository=new Repository(undefined,{max:3}),browser=new BrowserClient();
const reportPath='data/acceptance/obscura-stopped-revalidation.json';
try{
 const jobs=(await repository.pool.query("SELECT a.application_id,a.status,a.job_id,j.title,j.company,j.application_url,j.canonical_url FROM applications a JOIN jobs j USING(job_id) WHERE a.status='MANUAL_TAKEOVER' ORDER BY a.application_id")).rows;
 const results=[];let cursor=0;
 await Promise.all([0,1].map(async()=>{
  while(cursor<jobs.length){const job=jobs[cursor++];let sessionId,result;
   try{const opened=await browser.call('/sessions',{application_id:'read-'+job.application_id,url:job.application_url||job.canonical_url});sessionId=opened.session_id;
    const view=await browser.call(`/sessions/${sessionId}/snapshot`);result={...classifyLiveVacancy(job,view),url:view.url,http_status:view.http_status,observed_title:view.title};
   }catch(error){result={status:'UNKNOWN',reason:error.message};}
   finally{if(sessionId)await browser.call(`/sessions/${sessionId}`,undefined,'DELETE').catch(()=>{});}
   const row={...job,...result,checked_at:new Date().toISOString(),engine:'obscura-v0.2.4'};results.push(row);
   await repository.event('application',job.application_id,'OBSCURA_VACANCY_RECHECK',row);
   if(result.status==='CLOSED')await repository.pool.query("UPDATE jobs SET availability_status='CLOSED' WHERE job_id=$1",[job.job_id]);
   // Unknown access is not closure, and an OPEN result does not start sending.
   await fs.writeFile(reportPath,JSON.stringify({expected:jobs.length,processed:results.length,results},null,2),{mode:0o600});
   console.log(JSON.stringify({processed:results.length,total:jobs.length,title:job.title,status:result.status,reason:result.reason}));
  }
 }));
}finally{await repository.close();}
