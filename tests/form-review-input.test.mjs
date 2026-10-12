import test from 'node:test';import assert from 'node:assert/strict';import {compactFormReviewInput} from '../services/core/form-review-input.mjs';
test('HTML radio on values become one semantic employer answer with every option preserved',()=>{
 const input={cv:{},answers:[{id:3,name:'source',type:'radio',question:"I'm a user",group_label:'How did you hear?',value:'on',checked:false,required:true},{id:4,name:'source',type:'radio',question:'Job board',group_label:'How did you hear?',value:'on',checked:true,required:true},{id:5,type:'checkbox',question:'Privacy',value:'on',checked:true}]};
 const result=compactFormReviewInput(input);const radio=result.answers.find(a=>a.type==='radio-group');assert.equal(radio.id,4);assert.equal(radio.value,'Job board');assert.deepEqual(radio.options,["I'm a user",'Job board']);assert.equal(result.answers.find(a=>a.type==='checkbox').value,true);assert.equal(input.answers[0].value,'on');
});
