import test from 'node:test';import assert from 'node:assert/strict';import {operatorConfirmedAnswer} from '../services/core/operator-confirmed-answer.mjs';
test('personal answer is exact-scoped and optional omission cannot answer a mandatory field',()=>{
 const receipt={source:'USER_CHAT',application_id:'one',job_id:'job',profile_id:'profile',question:'Worked at GitLab?',answer:'No'};
 const app={application_id:'one',candidate_profile_id:'profile',last_state:{operator_answer_receipts:[receipt]}};
 assert.equal(operatorConfirmedAnswer({label:'Worked at GitLab?*',options:[{label:'No',value:0}]},app,{job_id:'job'}).value,0);
 assert.equal(operatorConfirmedAnswer({label:'Worked at GitLab?'},app,{job_id:'other'}),null);
 assert.equal(operatorConfirmedAnswer({label:'Worked at GitHub?'},app,{job_id:'job'}),null);
 receipt.omit=true;assert.equal(operatorConfirmedAnswer({label:'Worked at GitLab?',required:true},app,{job_id:'job'}),null);
});
