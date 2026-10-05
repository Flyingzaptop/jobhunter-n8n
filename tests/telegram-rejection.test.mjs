import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {Repository} from '../services/core/repository.mjs';import {Telegram} from '../services/core/telegram.mjs';
import {rejectPreparedApplication} from '../services/core/application-rejection.mjs';
test('rejection must reply to the owner review card and preserves the reason',async()=>{
 const t=new Telegram({chatId:'123'}),repo={pool:{query:async()=>({rows:[{application_id:'app',payload_json:{approval_id:'approval',binding_digest:'hash'},status:'PREPARED'}]})}};
 const message={chat:{id:123},from:{id:123},reply_to_message:{message_id:42},text:'ОТКЛОНИТЬ: только стационарная работа'};
 const a=await t.accept(repo,{message});assert.equal(a.command,'/reject_application');assert.equal(a.rejection_reason,'только стационарная работа');
 await assert.rejects(t.accept(repo,{message:{...message,from:{id:456}}}),/REPLY_REQUIRED/);
 await assert.rejects(t.accept(repo,{message:{...message,reply_to_message:undefined}}),/REPLY_REQUIRED/);
 await assert.rejects(t.accept({pool:{query:async()=>({rows:[]})}},{message}),/REVIEW_STALE/);
});
test('real PostgreSQL rejection revokes submission approval and cannot touch sent applications',{skip:!process.env.DATABASE_URL},async t=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='rejection_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const repo=new Repository();await repo.pool.end();repo.pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
 t.after(async()=>{await repo.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});await repo.migrate();
 const job=randomUUID(),app=randomUUID(),approval=randomUUID(),binding='a'.repeat(64),profile='fixture-rejection';
 await repo.pool.query('INSERT INTO jobs(job_id,canonical_url,company,title,description_text,content_hash)VALUES($1,$2,$3,$4,$5,$6)',[job,'https://fixture.invalid/job','ISOLATED','Fixture','Isolated test only.','fixture-hash']);
 await repo.pool.query("INSERT INTO applications(application_id,candidate_profile_id,job_id,status,dry_run)VALUES($1,$2,$3,'READY_TO_SUBMIT',true)",[app,profile,job]);
 await repo.pool.query("INSERT INTO application_review_gates(approval_id,application_id,candidate_profile_id,digests,binding_digest,expires_at)VALUES($1,$2,$3,'{}',$4,now()+interval '1 hour')",[approval,app,profile,binding]);
 const input={repository:repo,applicationId:app,profileId:profile,approvalId:approval,bindingDigest:binding,source:'USER_TELEGRAM',reason:'Onsite work rejected'};
 await assert.rejects(rejectPreparedApplication({...input,bindingDigest:'b'.repeat(64)}),/REVIEW_STALE/);
 assert.equal((await rejectPreparedApplication(input)).status,'SKIPPED');assert.equal((await rejectPreparedApplication(input)).duplicate,true);
 assert.equal((await repo.pool.query('SELECT status FROM application_review_gates WHERE approval_id=$1',[approval])).rows[0].status,'REVOKED');
 assert.equal((await repo.pool.query('SELECT last_state FROM applications WHERE application_id=$1',[app])).rows[0].last_state.user_rejection.reason,input.reason);
 await repo.pool.query("UPDATE applications SET status='SUBMITTED',submitted_at=now() WHERE application_id=$1",[app]);
 await assert.rejects(rejectPreparedApplication(input),/TOO_LATE/);
});
