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
