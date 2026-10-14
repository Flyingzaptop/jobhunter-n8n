import test from 'node:test';import assert from 'node:assert/strict';
import {mergeFieldSemantics} from '../services/browser-service/form-field-semantics.mjs';
import {missingRequiredFields} from '../services/browser-service/required-fields.mjs';
import {operatorConfirmedAnswer} from '../services/core/operator-confirmed-answer.mjs';
import {formBinding,digest} from '../services/dashboard/review-gates.mjs';
import {resolveField} from '../services/core/application.mjs';
import {selectedCookieButton} from '../services/core/form-settling.mjs';
import {choiceGroupQuestion,choiceGroupTarget} from '../services/core/choice-groups.mjs';
test('human questions contain the full group and a negative answer selects No rather than consenting to Yes',()=>{
 const fields=['Yes','No'].map(value=>({type:'checkbox',selection_group:'payment',form:0,form_id:'a',visible:true,value,label:value,group_label:'Accept payment terms?'}));
 assert.equal(choiceGroupQuestion(fields[0],fields),'Accept payment terms?\nOptions: Yes / No');
 assert.equal(choiceGroupTarget(fields[0],fields,'нет'),fields[1]);
 assert.equal(choiceGroupTarget(fields[0],fields,'maybe'),null);
 assert.equal(choiceGroupTarget({...fields[0],form_id:'different'},fields,'Yes'),null);
 const hours=fields.map((f,i)=>({...f,value:i?'6 - 8 hours':'4 - 6 hours',label:i?'6 - 8 hours':'4 - 6 hours'}));
 assert.equal(choiceGroupTarget(hours[0],hours,'да'),null);
});
test('cookie decline requires observed consent control and cannot authorize a form submit',()=>{
 const button={cookie_action:'deny',text:'Deny',type:'link',selector:'.deny'};
 assert.equal(selectedCookieButton({buttons:[button]}),button);
 assert.equal(selectedCookieButton({buttons:[{...button,type:'submit'}]}),null);
 assert.equal(selectedCookieButton({buttons:[{...button,form_id:'application'}]}),null);
 assert.equal(selectedCookieButton({buttons:[{text:'Deny',type:'link'}]}),null);
});
test('approval binding changes when the question behind identical Yes/No choices changes',()=>{
 const snapshot={fields:[{name:'choice',label:'Yes',type:'checkbox',checked:true,selection_group:'choice',group_label:'Payment terms?'}]};
 const before=digest(formBinding(snapshot));snapshot.fields[0].group_label='Relocation?';
 assert.notEqual(digest(formBinding(snapshot)),before);
});
test('GitHub URL is filled from the confirmed profile',()=>{
 assert.equal(resolveField({label:'GitHub URL',type:'text'},{profile:{onboarding:{github_url:'https://github.com/example'}},job:{}}).value,'https://github.com/example');
});
test('Lever custom questions retain labels and mandatory attributes when DOM reflection is absent',()=>{
 const [f]=mergeFieldSemantics([{type:'textarea',label:'',required:false}],[{question_label:'Experience?',attribute_required:true}]);
 assert.equal(f.label,'Experience?');assert.equal(f.required,true);
 assert.equal(missingRequiredFields([{...f,visible:true,value:''}]).length,1);
});
test('required multiple choice means one choice within the same form, not every checkbox',()=>{
 const fields=['Yes','No'].map(value=>({type:'checkbox',name:'cards[x][field0]',selection_group:'cards[x][field0]',group_label:'Payment terms?',required:true,visible:true,form_id:'a',value,checked:false}));
 assert.equal(missingRequiredFields(fields).length,2);
 fields[0].checked=true;assert.equal(missingRequiredFields(fields).length,0);
 const other={...fields[0],form_id:'b'};fields[0].checked=false;assert.equal(missingRequiredFields([...fields,other]).length,2);
 assert.equal(missingRequiredFields([{type:'checkbox',required:true,visible:true,checked:false}]).length,1);
});
test('a personal answer to a checkbox group never answers another Yes/No question',()=>{
 const receipt={source:'USER_CHAT',application_id:'a',job_id:'j',profile_id:'p',question:'Payment terms?',answer:'Yes'};
 const app={application_id:'a',candidate_profile_id:'p',last_state:{operator_answer_receipts:[receipt]}};
 const field={type:'checkbox',selection_group:'g',group_label:'Payment terms?',label:'Yes',value:'Yes'};
 assert.equal(operatorConfirmedAnswer(field,app,{job_id:'j'}).value,true);
 assert.equal(operatorConfirmedAnswer({...field,value:'No'},app,{job_id:'j'}).value,false);
 assert.equal(operatorConfirmedAnswer({...field,group_label:'Relocation?'},app,{job_id:'j'}),null);
});
