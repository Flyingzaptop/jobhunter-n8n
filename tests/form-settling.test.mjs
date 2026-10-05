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
