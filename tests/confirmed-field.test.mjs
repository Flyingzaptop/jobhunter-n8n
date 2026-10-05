import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmedFieldMatches} from '../services/core/confirmed-field.mjs';
test('only a current explicitly answered field can skip repeat questions, never a site default',()=>{
 const field={selector:'#work',label:'Work Authorization',type:'select-one',value:'authorized'};
 const view={fingerprint:'current'};
 const confirmed={label:field.label,type:field.type,value:field.value,fingerprint:view.fingerprint,question_id:'answered-question'};
 assert.equal(confirmedFieldMatches(field,view,confirmed),true);
 assert.equal(confirmedFieldMatches(field,view,undefined),false);
 for(const changed of [{label:'Visa sponsorship'},{type:'text'},{value:'sponsor'},{fingerprint:'old'},{question_id:null}])assert.equal(confirmedFieldMatches(field,view,{...confirmed,...changed}),false);
});
test('unchanged checkbox value does not preserve approval after its checked state changes',()=>{
 const field={selector:'#terms',label:'Terms',type:'checkbox',value:'on',checked:true},view={fingerprint:'form'};
 const confirmed={...field,fingerprint:'form',question_id:'answered-question'};
 assert.equal(confirmedFieldMatches(field,view,confirmed),true);
 assert.equal(confirmedFieldMatches({...field,checked:false},view,confirmed),false);
});
test('same scoped consent survives unrelated upload UI changes but not a changed document, clause or country',()=>{
 const context={profile_hash:'profile',job_country:'PL',cv_sha256:'approved-pdf'},field={selector:'#terms',label:'Regulation',type:'checkbox',value:'on',checked:true,required:true,form_action:'https://fixture.invalid/apply'};
 const view={fingerprint:'after-upload',url:field.form_action},confirmed={...field,question_id:'answer',question_type:'CONSENT',fingerprint:'before-upload',page_url:view.url,context};
 assert.equal(confirmedFieldMatches(field,view,confirmed,context),true);
 assert.equal(confirmedFieldMatches(field,view,confirmed,{...context,cv_sha256:'different-pdf'}),false);
 assert.equal(confirmedFieldMatches(field,view,confirmed,{...context,job_country:'DE'}),false);
 assert.equal(confirmedFieldMatches({...field,label:'Other terms'},view,confirmed,context),false);
 assert.equal(confirmedFieldMatches(field,view,{...confirmed,question_type:'FACT'},context),false);
});
