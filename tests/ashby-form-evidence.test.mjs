import test from 'node:test';import assert from 'node:assert/strict';
import {ashbyFormFields,ashbyFieldSaved} from '../services/browser-service/ashby-form-evidence.mjs';
import {explicitSubmissionReceipt,submissionPageSucceeded} from '../services/browser-service/submission-proof.mjs';
test('authoritative required fields and server values distinguish saved data from local text',()=>{
 const entries=ashbyFormFields({sections:[{fieldEntries:[{isRequired:true,field:{path:'linkedin',title:'LinkedIn'},fieldValue:{value:'"https://linkedin.com/in/confirmed"'}},{isRequired:true,isHidden:true,field:{path:'hidden'}}]}]});
 assert.equal(entries.get('linkedin').required,true);assert.equal(entries.has('hidden'),false);
 assert.equal(ashbyFieldSaved({value:'https://linkedin.com/in/confirmed'},entries.get('linkedin')),true);
 assert.equal(ashbyFieldSaved({value:'https://linkedin.com/in/other'},entries.get('linkedin')),false);
 assert.equal(ashbyFieldSaved({role:'combobox',value:'Poland'},{value:{text:'Poland',providerLocationId:'poland'}}),true);
 assert.equal(ashbyFieldSaved({type:'radio',checked:true,label:'Job board'},{value:'Job board '}),true);
});
test('submission receipts cannot come from draft saves or validation failures',()=>{
 const payload={data:{submitForm:{success:true}}};
 assert.ok(explicitSubmissionReceipt('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmitForm',payload));
 assert.equal(explicitSubmissionReceipt('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSetFormValue',payload),null);
 assert.equal(explicitSubmissionReceipt('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmitForm',{...payload,errors:[{message:'invalid'}]}),null);
 assert.equal(submissionPageSucceeded({text:'Thank you for applying',fields:[],validation_errors:[]}),true);
 assert.equal(submissionPageSucceeded({text:'Thank you for applying',fields:[{required:true,visible:true}]}),false);
 assert.equal(submissionPageSucceeded({text:'Thank you for applying',validation_errors:['Missing Location']}),false);
});
