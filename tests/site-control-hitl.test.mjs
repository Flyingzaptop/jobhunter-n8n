import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {Repository} from '../services/core/repository.mjs';
import {dismissSiteQuestion,answerApplicationQuestion,persistPendingApplicationQuestion} from '../services/core/hitl.mjs';
import {reusableQuestionAnswer} from '../services/core/answer-memory.mjs';
import {transition} from '../services/core/state.mjs';

test('Postgres: retire observed site controls without fake answers; remember explicit product use', {skip:!process.env.DATABASE_URL},async t=>{
 const repo=new Repository(),admin=repo.pool,schema='site_question_test_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);
 repo.pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`,max:4});
 t.after(async()=>{await repo.pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
 await repo.migrate();
 async function seed(field){
  const job=randomUUID(),app=randomUUID(),question=randomUUID(),request=randomUUID();
  await repo.pool.query("INSERT INTO jobs(job_id,canonical_url,company,title,description_text)VALUES($1,$2,'REGRESSION','Test','Fixture only')",[job,`https://example.invalid/${job}`]);
  const pending={request_id:request,type:'FACT',selector:field.selector,field_type:field.type,field_name:field.name??'',question:field.label,field_label:field.label};
  await repo.pool.query("INSERT INTO applications(application_id,candidate_profile_id,job_id,status,last_state)VALUES($1,'fixture',$2,'NEEDS_USER',$3)",[app,job,{pending_question:pending}]);
  await repo.pool.query('INSERT INTO application_questions(question_id,application_id,normalized_question,raw_question,telegram_request_id)VALUES($1,$2,$3,$3,$4)',[question,app,field.label,request]);
  return {app,question,request};
 }
 const theme={selector:'#theme',type:'checkbox',label:'Dark mode',form:null,required:false},a=await seed(theme);
 assert.equal(await dismissSiteQuestion(repo,{applicationId:a.app,snapshot:{fields:[{...theme,selector:'#other'}]}}),false);
 await assert.rejects(persistPendingApplicationQuestion(repo,{applicationId:a.app,rawQuestion:theme.label}),/SITE_CONTROL_IS_NOT/);
 assert.equal(await dismissSiteQuestion(repo,{applicationId:a.app,snapshot:{fields:[theme]}}),true);
 assert.equal(await dismissSiteQuestion(repo,{applicationId:a.app,snapshot:{fields:[theme]}}),false);
 const q=(await repo.pool.query('SELECT * FROM application_questions WHERE question_id=$1',[a.question])).rows[0];
 assert.equal(q.closed_reason,'SITE_APPEARANCE');assert.equal(q.answer,null);assert.equal(q.answered_at,null);
 assert.equal((await repo.pool.query('SELECT status FROM applications WHERE application_id=$1',[a.app])).rows[0].status,'FILLING');
 const use={selector:'#used',type:'textarea',label:'Have you used ElevenLabs - even in a personal or side project? What did you build or explore?'},b=await seed(use);
 assert.equal(await dismissSiteQuestion(repo,{applicationId:b.app,snapshot:{fields:[use]}}),false);
 await answerApplicationQuestion(repo,{questionId:b.question,correlationId:b.request,answer:'Yes, I have used ElevenLabs.',source:'USER_CHAT',profileId:'fixture'});
 const answer=await reusableQuestionAnswer(repo,{profileId:'fixture',field:{type:'textarea',label:'Have you ever used ElevenLabs?'},job:{}});
 assert.equal(answer.value,'Yes, I have used ElevenLabs.');assert.equal(answer.memory_version,1);
 const row=(await repo.pool.query('SELECT source FROM candidate_answer_memory WHERE memory_id=$1',[answer.memory_id])).rows[0];assert.equal(row.source,'USER_CHAT');
 const c=await seed(use),detail='Yes. I made a few lip-sync translation videos.';
 await answerApplicationQuestion(repo,{questionId:c.question,correlationId:c.request,answer:detail,source:'USER_TELEGRAM',profileId:'fixture'});
 assert.equal((await reusableQuestionAnswer(repo,{profileId:'fixture',field:use,job:{}})).value,detail);
 assert.equal((await reusableQuestionAnswer(repo,{profileId:'fixture',field:{type:'textarea',label:'Have you ever used ElevenLabs?'},job:{}})).value,'Yes, I have used ElevenLabs.');
 await repo.pool.query("INSERT INTO continuous_work(work_key,lane,entity_id,status,outcome_code)VALUES('parked','auto-submit',$1,'WAITING_USER','NEEDS_USER')",[c.app]);
 await transition(repo,c.app,'FILLING');await transition(repo,c.app,'READY_TO_SUBMIT');
 const work=(await repo.pool.query("SELECT status,next_retry_at FROM continuous_work WHERE work_key='parked'")).rows[0];
 assert.equal(work.status,'RETRY');assert.ok(work.next_retry_at);
});
