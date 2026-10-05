import test from 'node:test';import assert from 'node:assert/strict';
import {answerIntent,reusableQuestionAnswer} from '../services/core/answer-memory.mjs';
test('personal GitHub profile links reuse across job countries without borrowing repository answers',()=>{const a=answerIntent({label:'Link to your Github profile'},{country:'PL'}),b=answerIntent({label:'Link to your Github profile'},{country:'DE'});assert.equal(a.key,'github_profile_url');assert.deepEqual(a,b);assert.equal(answerIntent({label:'Link to the GitHub repository for this project'}),null);});
test('optional Github or personal website uses the same confirmed personal profile memory',()=>{assert.deepEqual(answerIntent({label:'Github or personal website'}),answerIntent({label:'Link to your Github profile'}));});

test('salary memory separates explicit contracts and role context without inferring a contract from full time',()=>{
 const field={label:'Expected gross monthly salary in PLN B2B'};
 const b2b=answerIntent(field,{country:'PL',roleContext:'Mechanical Engineer',employmentType:'Full-time'});
 const employment=answerIntent({label:'Expected gross monthly salary in PLN umowa o pracę'},{country:'PL',roleContext:'Mechanical Engineer',employmentType:'Full-time'});
 assert.equal(b2b.scope.contract_terms,'B2B');assert.equal(employment.scope.contract_terms,'EMPLOYMENT_CONTRACT');
 assert.notDeepEqual(b2b.scope,employment.scope);
 assert.notDeepEqual(b2b.scope,answerIntent(field,{country:'PL',roleContext:'IT Support',employmentType:'Full-time'}).scope);
 const unqualified=answerIntent({label:'Expected gross monthly salary in PLN'},{country:'PL',roleContext:'Mechanical Engineer',employmentType:'Full-time'});
 assert.equal(unqualified.scope.contract_terms,'full time');
});
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
