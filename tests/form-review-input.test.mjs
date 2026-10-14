import test from 'node:test';import assert from 'node:assert/strict';import {compactFormReviewInput} from '../services/core/form-review-input.mjs';
import {historicalFormAnswers} from '../services/core/form-review-input.mjs';
test('unversioned same-page snapshots never become phantom previous steps',()=>{
 const answers=[{label:'Old blank',value:''},{step:0,label:'First page'},{step:1,label:'Current page'}];
 assert.deepEqual(historicalFormAnswers(answers,1),[{step:0,label:'First page'}]);
 assert.deepEqual(historicalFormAnswers(answers,0),[{step:1,label:'Current page'}]);
});
test('Lever multi-select questions remain grouped and scoped operator answers survive compaction',()=>{
 const choices=['Yes','No'].map((question,i)=>({question,name:'conditions',selection_group:'conditions',group_label:'Accept project terms?',type:'checkbox',checked:i===1,required:true,expected_answer:i===1,form_id:'a'}));
 const result=compactFormReviewInput({answers:choices,accepted_human_answers:[{question:'Accept project terms?',answer:'No',source:'USER_CHAT'}]});
 assert.equal(result.answers.length,1);assert.equal(result.answers[0].type,'checkbox-group');
 assert.deepEqual(result.answers[0].value,['No']);assert.deepEqual(result.answers[0].expected_answer,['No']);
 assert.equal(result.accepted_human_answers[0].label,'Accept project terms?');assert.equal(result.accepted_human_answers[0].value,'No');
});
test('HTML radio on values become one semantic employer answer with every option preserved',()=>{
 const input={cv:{},answers:[{id:3,name:'source',type:'radio',question:"I'm a user",group_label:'How did you hear?',value:'on',checked:false,required:true},{id:4,name:'source',type:'radio',question:'Job board',group_label:'How did you hear?',value:'on',checked:true,required:true},{id:5,type:'checkbox',question:'Privacy',value:'on',checked:true}]};
 const result=compactFormReviewInput(input);const radio=result.answers.find(a=>a.type==='radio-group');assert.equal(radio.id,4);assert.equal(radio.value,'Job board');assert.deepEqual(radio.options,["I'm a user",'Job board']);assert.equal(result.answers.find(a=>a.type==='checkbox').value,true);assert.equal(input.answers[0].value,'on');
});
