import test from 'node:test';import assert from 'node:assert/strict';
import {answerIntent,reusableQuestionAnswer} from '../services/core/answer-memory.mjs';
test('salary answer scopes distinguish currency, period and gross/net, and vague salary is never guessed',()=>{
 const gross=answerIntent({label:'Expected gross monthly salary in PLN'},{country:'PL'});
 assert.deepEqual(gross.scope,{currency:'PLN',period:'MONTH',basis:'GROSS',country:'PL'});
 assert.notDeepEqual(gross,answerIntent({label:'Expected net monthly salary in PLN'},{country:'PL'}));
 assert.notDeepEqual(gross,answerIntent({label:'Expected gross annual salary in EUR'},{country:'DE'}));
 assert.equal(answerIntent({label:'Expected salary'},{country:'PL'}),null);
 assert.equal(answerIntent({label:'Right to work in Poland'},{country:'USA'}).scope.country,'PL');
 assert.equal(answerIntent({label:'Do you need visa sponsorship?'},{country:'USA'}),null);
 for(const label of ['Privacy consent','Captcha','Password','Passport number'])assert.equal(answerIntent({label}),null);
});
test('reusable personal answers retain source/version and cannot fill an invalid numeric or date field',async()=>{
 let row={memory_id:'memory',version:2,answer_json:'2026-11-01',updated_at:new Date()};
 const repository={pool:{query:async()=>({rows:[row]})}};
 const input={profileId:'p',field:{label:'Earliest start date',type:'date'},job:{country:'PL'}};
 assert.equal((await reusableQuestionAnswer(repository,input)).memory_version,2);
 row.answer_json='tomorrow';assert.equal(await reusableQuestionAnswer(repository,input),null);
 row.answer_json='negotiable';assert.equal(await reusableQuestionAnswer(repository,{...input,field:{label:'Expected gross monthly salary in PLN',type:'number'}}),null);
 row.updated_at=new Date(Date.now()-8*86400000);assert.equal(await reusableQuestionAnswer(repository,input),null);
});
