import {Repository} from '../services/core/repository.mjs';import {BrowserClient,runApplication,radioGroupAnswered} from '../services/core/application.mjs';
import {Telegram} from '../services/core/telegram.mjs';import {readFile} from 'node:fs/promises';import YAML from 'yaml';import {randomUUID} from 'node:crypto';
const id=process.argv[2];if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id??''))throw new Error('APPLICATION_UUID_REQUIRED');
if(process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT!=='false')throw new Error('CONTROLLED_DRY_RUN_REQUIRED');
const repository=new Repository(),browser=new BrowserClient();
try{
 const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8')),policy=YAML.parse(await readFile('config/search_policy.yaml','utf8'));
 const app=(await repository.pool.query('SELECT * FROM applications WHERE application_id=$1 AND candidate_profile_id=$2',[id,profile.profile_id])).rows[0];
 const pending=app?.last_state?.pending_question;
 if(app?.status!=='NEEDS_USER'||pending?.field_type!=='radio'||pending?.field_name!=='elementsChange'||pending.type!=='FACT'||!app.dry_run)throw new Error('NOT_DOCUMENT_RADIO_WAIT');
 const view=await browser.call(`/sessions/${app.last_state.browser_session_id}/snapshot`),field=view.fields.find(f=>f.selector===pending.selector);
 if(new URL(view.url).hostname!=='www.praca.pl'||!field||!radioGroupAnswered(field,view.fields))throw new Error('DOCUMENT_CHOICE_NOT_VERIFIED');
 const selected=view.fields.find(f=>f.type==='radio'&&f.name===field.name&&f.form===field.form&&f.checked);
 if(!/^aplikuję z plikiem cv$/i.test(selected?.label??''))throw new Error('VERIFIED_CV_CHOICE_REQUIRED');
 const client=await repository.pool.connect();try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[id]);
  const changed=await client.query("UPDATE application_questions SET closed_at=now(),closed_reason='DOCUMENT_RADIO_GROUP_RESOLVED' WHERE application_id=$1 AND telegram_request_id=$2 AND closed_at IS NULL AND answer IS NULL RETURNING question_id",[id,pending.request_id]);
  if(changed.rowCount!==1)throw new Error('QUESTION_CHANGED');
  const resumed=await client.query("UPDATE applications SET status='FILLING',last_state=last_state||$3::jsonb,updated_at=now() WHERE application_id=$1 AND status='NEEDS_USER' AND last_state->'pending_question'->>'request_id'=$2",[id,pending.request_id,{pending_question:null}]);
  if(resumed.rowCount!==1)throw new Error('APPLICATION_CHANGED');
  await client.query('INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json)VALUES($1,$2,$3,$4,$5)',[randomUUID(),'application',id,'DOCUMENT_RADIO_RESOLVED',{question_id:changed.rows[0].question_id,source:'VERIFIED_FORM_STATE',user_answer_invented:false}]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 const result=await runApplication({repository,jobId:app.job_id,applicationId:id,profile,policy,browser,telegram:new Telegram()});
 console.log(JSON.stringify({application_id:id,status:result.status,reason:result.reason??null}));
}finally{await repository.close();}
