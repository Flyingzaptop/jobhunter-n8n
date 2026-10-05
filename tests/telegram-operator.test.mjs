import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {Repository} from '../services/core/repository.mjs';import {Telegram} from '../services/core/telegram.mjs';
import {operatorInbox,replyToOperator} from '../services/core/telegram-operator.mjs';
test('two way owner messages survive restart, deduplicate updates and reply to the exact human message',{skip:!process.env.DATABASE_URL},async t=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='operator_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const repo=new Repository();await repo.pool.end();repo.pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
 t.after(async()=>{await repo.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});await repo.migrate();
 const telegram=new Telegram({chatId:'123'}),update={update_id:42,message:{message_id:77,from:{id:123},chat:{id:123},text:'Нужен hybrid, а не стационарная работа'}};
 const receipt=await telegram.processUpdate(repo,update,async accepted=>({status:'SAVED_FOR_OPERATOR'}));assert.equal(receipt.dispatch_status,'COMPLETED');
 assert.equal((await telegram.processUpdate(repo,update,()=>{throw Error('duplicate dispatch');})).duplicate,true);
 const notes=await operatorInbox(repo);assert.equal(notes.length,1);assert.equal(notes[0].text,update.message.text);
 let sent;const transport={chatId:'123',call:async(method,payload)=>{sent={method,payload};return {message_id:88};}};
 await assert.rejects(replyToOperator({repository:repo,telegram:{...transport,chatId:'999'},updateId:42,messageId:77,text:'Got it'}),/MESSAGE_NOT_FOUND/);
 await replyToOperator({repository:repo,telegram:transport,updateId:42,messageId:77,text:'Принял, стационарные исключены.'});
 assert.equal(sent.payload.reply_parameters.message_id,77);assert.equal((await operatorInbox(repo)).length,0);
 assert.equal((await repo.pool.query('SELECT count(*)::int n FROM applications')).rows[0].n,0);
});
