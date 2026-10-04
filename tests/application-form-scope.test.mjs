import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeApplicationForm} from '../services/browser-service/application-form-scope.mjs';
const view={fingerprint:'whole-page-fingerprint',forms:[{id:'talent',action:'https://example.com/talent',method:'post',enctype:'application/x-www-form-urlencoded'},{id:'application',action:'https://example.com/applications',method:'post',enctype:'multipart/form-data'}],fields:[{visible:true,type:'email',form:0,name:'email',label:'Email'},{visible:true,type:'email',form:1,name:'email',label:'Email'},{visible:true,type:'file',form:1,required:true,label:'Resume'}],buttons:[{text:'Join talent community',type:'submit',form_action:'https://example.com/talent'},{text:'Submit your application',type:'submit',form_action:'https://example.com/applications'},{text:'Apply now',type:'link'}]};
test('uniquely identified multipart CV form excludes talent community fields and submission',()=>{
 const scoped=scopeApplicationForm(view);assert.equal(scoped.pass,true);assert.equal(scoped.form_index,1);assert.equal(scoped.view.fields.length,2);assert.ok(scoped.view.fields.every(f=>f.form===1));assert.equal(scoped.view.buttons.some(b=>b.text==='Join talent community'),false);assert.equal(scoped.view.fingerprint,view.fingerprint);
});
test('ambiguous multiple CV forms and unverified submit scope fail closed',()=>{
 assert.equal(scopeApplicationForm({...view,fields:[...view.fields,{visible:true,type:'file',form:0,required:true,label:'Resume'}]}).pass,false);
 assert.equal(scopeApplicationForm({...view,buttons:[]}).pass,false);
 assert.equal(scopeApplicationForm({...view,forms:[view.forms[0],{...view.forms[1],method:'get'}]}).pass,false);
 assert.equal(scopeApplicationForm({...view,fields:view.fields.filter(f=>f.type!=='file')}).pass,false);
});
test('form-less SPA and a single candidate form retain the complete snapshot',()=>{
 const spa={fields:[{visible:true,type:'email',form:null}],buttons:[],fingerprint:'spa'};assert.equal(scopeApplicationForm(spa).view,spa);
 assert.equal(scopeApplicationForm({...view,fields:view.fields.filter(f=>f.form===1)}).pass,true);
});
