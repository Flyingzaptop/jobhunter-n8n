import test from 'node:test';import assert from 'node:assert/strict';
import {postingOpenEvidence,radioGroupAnswered,humanConsentAnswer} from '../services/core/application.mjs';
test('human consent recognizes explicit Polish and Russian replies but never assumes conditional approval',()=>{
 for(const answer of ['Да','Tak','Разрешаю для этой заявки','yes'])assert.equal(humanConsentAnswer(answer),true);
 for(const answer of ['Нет','Nie','Не разрешаю — пропустить заявку'])assert.equal(humanConsentAnswer(answer),false);
 assert.equal(humanConsentAnswer('да, но не создавай аккаунт'),null);
});
import {finalSubmitLabel} from '../services/browser-service/ats-adapters.mjs';
test('Polish final submit labels normalize accents without confusing application entry, next step or OTP send',()=>{
 for(const label of ['WYŚLIJ','Wyślij aplikację','Wyślij zgłoszenie','Submit application'])assert.equal(finalSubmitLabel(label),true);
 for(const label of ['Aplikuj szybko','Dalej','Wyślij kod','Akceptuj wybrane'])assert.equal(finalSubmitLabel(label),false);
});
test('a selected radio alternative satisfies its group but cannot satisfy another form or a disabled selection',()=>{
 const field={type:'radio',name:'elementsChange',form:0,checked:false};
 const selected={...field,checked:true,visible:true};
 assert.equal(radioGroupAnswered(field,[selected,field]),true);
 assert.equal(radioGroupAnswered(field,[{...selected,form:1},field]),false);
 assert.equal(radioGroupAnswered(field,[{...selected,disabled:true},field]),false);
 assert.equal(radioGroupAnswered({...field,name:''},[selected]),false);
});
test('Polish vacancy identity and visible Aplikuj prove open; login and unrelated postings remain unknown',()=>{
 const job={title:'Technik utrzymania ruchu',canonical_url:'https://www.praca.pl/technik_123.html'};
 const view={url:job.canonical_url,title:'Oferta pracy: Technik utrzymania ruchu',text:'Technik utrzymania ruchu',buttons:[{text:'Aplikuj',visible:true,disabled:false}]};
 assert.equal(postingOpenEvidence(view,job),'OPEN');
 assert.equal(postingOpenEvidence({...view,captcha:true},job),'UNKNOWN');
 for(const changed of [{url:'https://www.praca.pl/login'},{title:'Login',text:'Logowanie'},{buttons:[]},{buttons:[{text:'Aplikuj',disabled:true}]},{text:'Oferta jest nieaktualna'}])assert.equal(postingOpenEvidence({...view,...changed},job),changed.text==='Oferta jest nieaktualna'?'CLOSED':'UNKNOWN');
});
