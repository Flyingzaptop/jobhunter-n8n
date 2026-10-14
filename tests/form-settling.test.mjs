import test from 'node:test';import assert from 'node:assert/strict';
import {selectedCookieButton,settleApplicationForm} from '../services/core/form-settling.mjs';
test('Praca cookie settling selects only the explicit selected-cookie action, never all consent or application Submit',async()=>{
 const view={url:'https://www.praca.pl/job_123.html',text:'Zgoda na Pliki Cookies',fields:[],buttons:[{selector:'#all',type:'button',text:'Akceptuj wszystkie'},{selector:'#selected',type:'button',text:'Akceptuj wybrane'}]};
 assert.equal(selectedCookieButton(view).selector,'#selected');
 assert.equal(selectedCookieButton({...view,url:'https://employer.example/apply'}),null);
 assert.equal(selectedCookieButton({...view,buttons:[{...view.buttons[1],final_submit:true}]}),null);
 const calls=[];let dismissed=false;
 const browser={call:async(endpoint,payload)=>{if(endpoint.endsWith('/dismiss-cookies')){calls.push('COOKIE_ONLY');dismissed=true;}return dismissed?{...view,text:'Form',cookie_dismissal:{status:'DISMISSED'},buttons:[],fingerprint:'ready',fields:[{visible:true,type:'email'}]}:view;}};
 await settleApplicationForm({browser,sessionId:'fixture',initialView:view,maxMs:1200});
 assert.deepEqual(calls,['COOKIE_ONLY']);
});
import {settleDocumentProcessing,documentProcessing} from '../services/core/form-settling.mjs';
test('employer AI disclaimer mentioning analyzing resumes is not an active upload',()=>{
 assert.equal(documentProcessing({text:"cv.pdf\nCouldn't auto-read resume.\nWe use AI for reviewing applications, analyzing resumes, or assessing responses."}),false);
 assert.equal(documentProcessing({text:'cv.pdf\nAnalyzing resume...\nFull name'}),true);
});
test('resume analysis settles before final review and a progressing upload stays retryable',async()=>{
 let reads=0;const browser={call:async()=>({text:++reads<2?'Analyzing resume...':'cv.pdf Success!'})};
 const done=await settleDocumentProcessing({browser,sessionId:'s',initialView:{text:'Analyzing resume...'},pollMs:1,maxMs:200});
 assert.equal(done.pending,false);assert.equal(reads,2);
 const pending=await settleDocumentProcessing({browser:{call:async()=>({text:'Analyzing resume...'})},sessionId:'s',initialView:{text:'Analyzing resume...'},pollMs:1,maxMs:3});assert.equal(pending.pending,true);
});
