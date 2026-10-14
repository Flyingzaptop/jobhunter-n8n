import test from 'node:test';import assert from 'node:assert/strict';
import {mergeFieldSemantics} from '../services/browser-service/form-field-semantics.mjs';
import {missingRequiredFields} from '../services/browser-service/required-fields.mjs';
import {operatorConfirmedAnswer} from '../services/core/operator-confirmed-answer.mjs';
import {formBinding,digest} from '../services/dashboard/review-gates.mjs';
import {resolveField} from '../services/core/application.mjs';
import {selectedCookieButton} from '../services/core/form-settling.mjs';
import {choiceGroupQuestion,choiceGroupTarget} from '../services/core/choice-groups.mjs';
import {validateQuestionAnswer} from '../services/core/hitl.mjs';
import {standingRecruitmentConsent,standingRecruitmentSelectAnswer} from '../services/core/consent-policy.mjs';
import {answerIntent,reusableQuestionAnswer} from '../services/core/answer-memory.mjs';
test('standing recruitment consent works for selects without agreeing to relocation or marketing',()=>{
 const field={type:'select-one',label:'I agree to the Privacy Policy for current recruitment',options:[{label:'I agree',value:'yes'}]};const policy={consent_policy:{current_recruitment_data_processing:true}};
 assert.equal(standingRecruitmentSelectAnswer(field,policy).value,'yes');
 assert.equal(standingRecruitmentSelectAnswer({...field,label:field.label+' and relocation'},policy),null);
 assert.equal(standingRecruitmentSelectAnswer({...field,label:field.label+' and marketing'},policy),null);
 assert.equal(standingRecruitmentConsent({type:'checkbox',label:'Yes, TSMG can contact me about future job opportunities for up to 10 yearsPrivacy policy'},policy),false);
});
test('project work preferences only reuse on an accepted FIT and cannot answer unrelated legal questions',async()=>{
 const field={selection_group:'contract',group_label:'Are you comfortable working as a freelancer under an Independent Contractor Agreement?',type:'checkbox',value:'Yes',label:'Yes'};
 assert.equal(answerIntent(field).key,'confirmed_project_conditions');
 assert.equal(answerIntent({...field,group_label:'Do you agree to waive your legal rights?'}),null);
 const repository={pool:{query:async sql=>sql.startsWith('SELECT 1 FROM job_analysis')?{rowCount:0,rows:[]}:{rows:[{answer_json:'Yes',memory_id:'m',version:1}]}}};
 assert.equal(await reusableQuestionAnswer(repository,{profileId:'p',field,job:{job_id:'j'}}),null);
});
test('HITL rejects a generic yes for hours but accepts a specific offered range',()=>{
 const pending={selection_group:'hours',choices:[{label:'4 - 6 hours',value:'4 - 6 hours'},{label:'6 - 8 hours',value:'6 - 8 hours'}]};
 assert.throws(()=>validateQuestionAnswer({raw_question:'Hours?'},pending,'да'),/EXPECTED_OPTION/);
 assert.doesNotThrow(()=>validateQuestionAnswer({raw_question:'Hours?'},pending,'6 - 8 hours'));
});
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
test('a GitHub profile is not relabelled as an unknown separate portfolio',()=>{
 const profile={onboarding:{github_url:'https://github.com/example',portfolio_url:'UNKNOWN'}};
 assert.equal(resolveField({label:'Portfolio URL',type:'text',required:false},{profile,job:{}}).value,'');
 assert.equal(resolveField({label:'Portfolio URL',type:'text',required:true},{profile,job:{}}),null);
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
