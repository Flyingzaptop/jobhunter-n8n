import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {Repository} from '../services/core/repository.mjs';
import {isModelAnswerable,validateProseClaims,generateProse,enqueue,getReady,consume,drain} from '../services/core/application-prose.mjs';
const facts=[{id:'project_api',provenance:'PERSONAL_PROJECT',statements:['Built a personal API troubleshooting utility using Python.']}];
const document={language:'English',segments:[{kind:'FACT',text:'In a personal project, I built an API troubleshooting utility using Python.',fact_ids:['project_api']},{kind:'APPROACH',text:'I would reproduce the issue, check request inputs, and document a focused solution.',fact_ids:[]}]};
test('general employer prose is automated while unknown personal/legal/security fields stay human',()=>{
 for(const label of ['Why Linear?','What is your experience troubleshooting APIs?','How would you approach an integration failure?','Describe your strengths and working style.','What is authentication and how would you troubleshoot it?'])assert.equal(isModelAnswerable({type:'textarea',label}),true,label);
 for(const label of ['Work authorization','Expected salary','When can you start? Earliest start date','Do you require an export license?','Privacy consent','Enter authentication code','Will you relocate?','How many years of commercial experience?','What is your graduation date?','Has someone referred you for this role?','Name (required)'])assert.equal(isModelAnswerable({type:'text',label}),false,label);
 assert.equal(isModelAnswerable({type:'select-one',label:'Why this role?',options:[]}),false);
 assert.equal(isModelAnswerable({type:'text',label:'Optional additional note',required:false}),false);
 assert.equal(isModelAnswerable({type:'textarea',label:'Why this role?',required:false}),true);
 for(const label of ['What is your phone number?','Please provide your legal name','Current or most recent title','How did you hear about this role?'])assert.equal(isModelAnswerable({type:'text',label}),false,label);
 assert.equal(isModelAnswerable({type:'textarea',label:'How would you validate email addresses in an API?'}),true);
});
test('claim validator preserves project provenance, cited IDs, numeric limits and separates normative approach',()=>{
 assert.equal(validateProseClaims(document,facts).pass,true);
 for(const segment of [{kind:'FACT',text:'I have professional experience delivering client API integrations.',fact_ids:['project_api']},{kind:'FACT',text:'I built 100 production tools.',fact_ids:['project_api']},{kind:'FACT',text:'I know everything.',fact_ids:['missing']},{kind:'APPROACH',text:'I led a team for commercial clients.',fact_ids:[]},{kind:'INTEREST',text:'Linear has always been my dream company.',fact_ids:[]}])assert.equal(validateProseClaims({...document,segments:[segment]},facts).pass,false);
});
test('writer output requires independent complete entailment and never calls a cloud provider',async()=>{
 let calls=0;const llm={provider:'local',model:'isolated-gemma',json:async request=>{calls++;assert.equal(request.strong,false);if(calls===1)return document;return {checks:document.segments.map((_,i)=>({segment_id:'s'+i,verdict:'SUPPORTED'}))};}};
 const result=await generateProse({llm,input:{facts,question:'Why this role?',job:{title:'Support'},explicit_preferences:{}}});assert.equal(result.provenance,'MODEL_GROUNDED');assert.equal(result.qa.pass,true);assert.equal(calls,2);
 await assert.rejects(generateProse({llm:{provider:'openrouter'},input:{facts}}),/LOCAL_PROSE_INFERENCE_REQUIRED/);
 let n=0;await assert.rejects(generateProse({llm:{provider:'local',json:async()=>++n===1?document:{checks:[{segment_id:'s0',verdict:'SUPPORTED'},{segment_id:'s1',verdict:'UNCERTAIN'}]}},input:{facts}}),/PROSE_SEMANTIC_ENTAILMENT_REJECTED/);
});
test('actual PostgreSQL: durable exact binding, busy inference stays pending, model-ready answer consumes without human receipt',{skip:!process.env.DATABASE_URL,timeout:30000},async t=>{
 const repo=new Repository(),admin=repo.pool,schema='prose_test_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);repo.pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`,max:5});t.after(async()=>{await repo.pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});await repo.migrate();
 const appId=randomUUID(),job={job_id:randomUUID(),company:'ISOLATED',title:'Support engineer',description_text:'Troubleshoot APIs.',content_hash:'actual-fixture-job-hash'},profile={profile_id:'prose-fixture',projects:facts},policy={remote_only:true},field={selector:'#why',label:'Why this role?',type:'textarea'},view={fingerprint:'exact-fixture-form'};
 await repo.pool.query('INSERT INTO jobs(job_id,canonical_url,application_url,company,title,description_text,content_hash)VALUES($1,$2,$2,$3,$4,$5,$6)',[job.job_id,`https://fixture.invalid/${job.job_id}`,job.company,job.title,job.description_text,job.content_hash]);await repo.pool.query("INSERT INTO applications(application_id,candidate_profile_id,job_id,status)VALUES($1,$2,$3,'FILLING')",[appId,profile.profile_id,job.job_id]);
 const args={repo,appId,job,profile,policy,field,view},one=await enqueue(args),same=await enqueue(args);assert.equal(one.draft_id,same.draft_id);assert.equal(one.status,'PENDING');
 const busy=await drain({repo,profile,policy,mutex:async()=>({blocked_reason:'INFERENCE_BATCH_BUSY',processed:0}),llm:{provider:'local',json:()=>{throw new Error('Busy must not infer');}}});assert.ok(busy.blocked_reason);
 let calls=0;const result=await drain({repo,profile,policy,mutex:async(_,operation)=>operation(),llm:{provider:'local',model:'isolated-gemma',json:async()=>++calls===1?document:{checks:[{segment_id:'s0',verdict:'SUPPORTED'},{segment_id:'s1',verdict:'SUPPORTED'}]}}});assert.equal(result.results[0].status,'READY');
 const ready=await getReady(args);assert.equal(ready.provenance,'MODEL_GROUNDED');assert.ok(ready.text_answer.includes('personal project'));assert.equal(await getReady({...args,view:{fingerprint:'changed-form'}}),null);assert.equal(await getReady({...args,policy:{remote_only:false}}),null);
 await consume({repo,appId,draftId:ready.draft_id});await assert.rejects(consume({repo,appId,draftId:ready.draft_id}),/ALREADY_CONSUMED/);assert.equal((await repo.pool.query('SELECT count(*)::int AS n FROM application_answer_receipts')).rows[0].n,0);assert.equal((await repo.pool.query('SELECT count(*)::int AS n FROM application_questions')).rows[0].n,0);
 const pending=await enqueue({...args,field:{...field,selector:'#approach',label:'How would you approach this work?'}});
 const operation={repo,profile,policy,mutex:async(_,run)=>run(),llm:{provider:'local',json:async()=>{throw Object.assign(new Error('private detail'),{code:'INPUT_BUDGET_EXCEEDED'});}}};
 const failed=await drain(operation);assert.equal(failed.results[0].error_code,'INPUT_BUDGET_EXCEEDED');
 let state=(await repo.pool.query('SELECT status,attempt_count,next_retry_at FROM application_prose_drafts WHERE draft_id=$1',[pending.draft_id])).rows[0];
 assert.equal(state.status,'RETRY');assert.equal(state.attempt_count,0);assert.ok(state.next_retry_at>new Date());assert.equal((await drain(operation)).processed,0);
 await repo.pool.query("UPDATE application_prose_drafts SET status='GENERATING',attempt_count=1 WHERE draft_id=$1",[pending.draft_id]);
 await drain(operation);state=(await repo.pool.query('SELECT status,attempt_count FROM application_prose_drafts WHERE draft_id=$1',[pending.draft_id])).rows[0];assert.equal(state.status,'RETRY');assert.equal(state.attempt_count,0);
});
