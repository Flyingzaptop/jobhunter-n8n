import {Repository} from '../services/core/repository.mjs';
import {BrowserClient} from '../services/core/application.mjs';
const repository=new Repository(),browser=new BrowserClient();try{
 const rows=(await repository.pool.query("SELECT a.application_id,a.last_state,j.title,j.company,j.canonical_url,j.application_url FROM applications a JOIN jobs j USING(job_id) ORDER BY a.started_at DESC LIMIT 3")).rows;
 for(const row of rows){let view;try{view=await browser.call('/sessions/'+row.last_state?.browser_session_id+'/snapshot');}catch{}
 console.log(JSON.stringify({application_id:row.application_id,company:row.company,target_title:row.title,canonical_url:row.canonical_url,application_url:row.application_url,actual_url:view?.url,actual_title:view?.title,policy_fields:view?.fields?.filter(f=>/own words|generated content|disqualif|AI\b/i.test(f.label)).map(f=>f.label)}));}
}finally{await repository.close();}
