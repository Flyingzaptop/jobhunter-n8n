import test from 'node:test';import assert from 'node:assert/strict';
import {ashbyFormFields,ashbyFieldSaved} from '../services/browser-service/ashby-form-evidence.mjs';
import {explicitSubmissionReceipt,submissionPageSucceeded,ashbySuccessPage} from '../services/browser-service/submission-proof.mjs';
test('authoritative required fields and server values distinguish saved data from local text',()=>{
 const entries=ashbyFormFields({sections:[{fieldEntries:[{isRequired:true,field:{path:'linkedin',title:'LinkedIn'},fieldValue:{value:'"https://linkedin.com/in/confirmed"'}},{isRequired:true,isHidden:true,field:{path:'hidden'}}]}]});
 assert.equal(entries.get('linkedin').required,true);assert.equal(entries.has('hidden'),false);
 assert.equal(ashbyFieldSaved({value:'https://linkedin.com/in/confirmed'},entries.get('linkedin')),true);
 assert.equal(ashbyFieldSaved({value:'https://linkedin.com/in/other'},entries.get('linkedin')),false);
 assert.equal(ashbyFieldSaved({role:'combobox',value:'Poland'},{value:{text:'Poland',providerLocationId:'poland'}}),true);
 assert.equal(ashbyFieldSaved({type:'radio',checked:true,label:'Job board'},{value:'Job board '}),true);
 const file=ashbyFormFields({sections:[{fieldEntries:[{field:{path:'resume'},fieldValue:{id:'approved-file',filename:'cv.pdf'}}]}]}).get('resume');assert.equal(ashbyFieldSaved({type:'file'},file),true);assert.equal(ashbyFieldSaved({type:'file'},{value:null}),false);
});
test('observed Ashby success page belongs to the exact attempted application and has no live submit form',()=>{
 const url='https://jobs.ashbyhq.com/linear/820d0d5a-0930-475c-b494-23e18ad2aa68/application',view={url,text:'Success\n\nThank you — your application was successfully submitted.',fields:[],buttons:[],validation_errors:[]};
 assert.equal(ashbySuccessPage(view,url),true);assert.equal(ashbySuccessPage(view,url.replace('/linear/','/other/')),false);
 assert.equal(ashbySuccessPage({...view,buttons:[{visible:true,text:'Submit Application'}]},url),false);
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
