import {readFile,mkdir,writeFile} from 'node:fs/promises';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {BrowserClient} from '../services/core/application.mjs';
import {OllamaClient} from '../services/core/llm.mjs';
import {enqueue,drain} from '../services/core/application-prose.mjs';
const id=process.argv[2];
if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id??''))throw new Error('APPLICATION_ID_REQUIRED');
const repo=new Repository(),browser=new BrowserClient();
try{
 await repo.migrate();
 const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));
 const policy=YAML.parse(await readFile('config/search_policy.yaml','utf8'));
 const app=(await repo.pool.query('SELECT * FROM applications WHERE application_id=$1 AND candidate_profile_id=$2',[id,profile.profile_id])).rows[0];
 if(!app||app.status==='SKIPPED')throw new Error('ACTIVE_OWNED_APPLICATION_REQUIRED');
 const pending=app.last_state?.prose_pending_question;
 if(!pending)throw new Error('PENDING_PROSE_FIELD_REQUIRED');
 const row=(await repo.pool.query('SELECT * FROM jobs WHERE job_id=$1',[app.job_id])).rows[0],job={...row.metadata,...row};
 const view=await browser.call(`/sessions/${app.last_state.browser_session_id}/snapshot`);
 const field=view.fields.find(f=>f.selector===pending.selector&&f.label===pending.field_label);
 if(!field)throw new Error('CURRENT_EXACT_FIELD_REQUIRED');
 const queued=await enqueue({repo,appId:id,field,view,profile,job,policy});
 console.log(JSON.stringify({queued:queued.queued,draft_id:queued.draft_id,status:queued.status}));
 const result=await drain({repo,profile,policy,llm:new OllamaClient(),max:1});
 await mkdir('tests/results',{recursive:true});await writeFile('tests/results/application-prose-live.json',JSON.stringify({application_id:id,...result,model_source:'MODEL_GROUNDED',user_answer_fabricated:false},null,2));
 console.log(JSON.stringify(result));
}finally{await repo.close();}
