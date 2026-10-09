import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeApplicationForm} from '../services/browser-service/application-form-scope.mjs';
import {isModelAnswerable} from '../services/core/application-prose.mjs';

test('Jobicy page chrome is not an application, including its GET search submit',()=>{
 const view={fingerprint:'unchanged-binding',fields:[
  {selector:'#jobicy-header-keywords',name:'search_keywords',type:'search',label:'Job title, company or skill',visible:true,required:false,form:0,form_method:'get',form_action:'https://jobicy.com/jobs/'},
  {selector:'[data-jh-index="1"]',name:'',type:'checkbox',label:'Dark mode',visible:true,required:false,form:null},
  {selector:'#global_resume_upload_input',name:'',type:'file',label:'',visible:false,required:false,form:null},
 ],buttons:[{text:'',type:'submit',form_action:'https://jobicy.com/jobs/'},{text:'Apply Now',type:'button'}]};
 const scoped=scopeApplicationForm(view);
 assert.equal(scoped.pass,true);assert.deepEqual(scoped.view.fields,[]);
 assert.deepEqual(scoped.view.buttons,[view.buttons[1]]);
 assert.equal(scoped.view.fingerprint,view.fingerprint);
 assert.equal(isModelAnswerable({...view.fields[0],type:'text',form_method:'get'}),false);
});

test('employer questions about themes and search skills remain real fields',()=>{
 const fields=[{type:'textarea',label:'Have you implemented dark mode?',visible:true},
  {type:'checkbox',label:'Dark mode',group_label:'Which UI features have you implemented?',name:'features',visible:true,form:0},
  {type:'text',label:'Explain your search engine development experience',visible:true}];
 assert.deepEqual(scopeApplicationForm({fields,buttons:[]}).view.fields,fields);
 assert.equal(isModelAnswerable(fields[2]),true);
});
