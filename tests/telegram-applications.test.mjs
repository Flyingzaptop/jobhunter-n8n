import test from 'node:test';import assert from 'node:assert/strict';
import {acceptTelegramSubmit,vacancySummary,countsText,countsHtml} from '../services/core/telegram-applications.mjs';
test('Telegram final confirmation requires the owner and an exact replied-to prepared review',async()=>{
 let reads=0;const repo={pool:{query:async()=>{reads++;return{rows:[{application_id:'application',status:'PREPARED',expires_at:new Date(Date.now()+10000),payload_json:{approval_id:'approval',binding_digest:'digest'}}]};}}};
 await assert.rejects(acceptTelegramSubmit(repo,{from:{id:2},reply_to_message:{message_id:1}},'1'),/REPLY_REQUIRED/);assert.equal(reads,0);
 await assert.rejects(acceptTelegramSubmit(repo,{from:{id:1}},'1'),/REPLY_REQUIRED/);
 await assert.rejects(acceptTelegramSubmit(repo,{from:{id:1,is_bot:true},reply_to_message:{message_id:1}},'1'),/REPLY_REQUIRED/);
 const result=await acceptTelegramSubmit(repo,{from:{id:1},reply_to_message:{message_id:42}},'1');
 assert.equal(result.command,'/confirm_submit');assert.equal(result.binding_digest,'digest');assert.match(result.idempotency_key,/^[a-f0-9-]{36}$/);
 await assert.rejects(acceptTelegramSubmit({pool:{query:async()=>({rows:[]})}},{from:{id:1},reply_to_message:{message_id:43}},'1'),/REVIEW_STALE/);
});
test('vacancy summary distinguishes partial fit, unknown geography and actual sent counts',()=>{
 const text=vacancySummary({title:'Engineer',company:'Employer',location:'EU',work_mode:'REMOTE',description_text:'Real duties',canonical_url:'https://example.invalid/job'},{overall_fit:60,decision:'STRETCH',requirements:[{match:'PARTIAL',requirement:'Strong CAD',reason:'Academic CAD only'},{match:'UNKNOWN',importance:'MANDATORY',requirement:'Certificate'}]});
 assert.ok(text.includes('Частично'));assert.ok(text.includes('Academic CAD only'));assert.ok(text.includes('не подтверждена'));assert.ok(text.includes('Certificate'));
 assert.ok(countsText({found:100,cv:2,ready:1,submitted:0,waiting:1,unknown:0}).includes('Подтверждённо отправлено: 0'));
 assert.ok(countsHtml({found:100,cv:2,ready:1,submitted:0,waiting:1,unknown:0}).includes('<b>Заявки</b>'));
 assert.ok(vacancySummary({title:'<bad>',company:'&',canonical_url:'https://example.invalid/'},{}).includes('&lt;bad&gt;'));
});
