import test from 'node:test';
import assert from 'node:assert/strict';
import {atsAdapterFor,reviewedReadPost,safeNavigationButton,observerUrl} from '../services/browser-service/ats-adapters.mjs';
test('ATS host boundaries and public Workday read POST cannot authorize candidate submission',()=>{
 assert.equal(atsAdapterFor('https://evilgreenhouse.io/apply'),'generic');
 const data={appliedFacets:{},limit:20,offset:0,searchText:''};
 const request={url:'https://example.myworkdayjobs.com/wday/cxs/example/jobs/jobs',adapter:'workday',body:JSON.stringify(data)};
 assert.equal(reviewedReadPost(request).allowed,true);
 assert.equal(reviewedReadPost({...request,body:JSON.stringify({...data,email:'candidate@example.com'})}).allowed,false);
 assert.equal(reviewedReadPost({...request,url:'https://example.myworkdayjobs.com/apply'}).allowed,false);
 assert.equal(reviewedReadPost({...request,adapter:'lever'}).allowed,false);
});
test('navigation rejects required fields, submit buttons and cross-origin candidate writes',()=>{
 const input={adapter:'lever',url:'https://jobs.lever.co/acme/id',fields:[],button:{text:'Apply',type:'link',href:'https://jobs.lever.co/acme/id/apply'}};
 assert.equal(safeNavigationButton(input),true);
 assert.equal(safeNavigationButton({...input,fields:[{required:true,visible:true}]}),false);
 assert.equal(safeNavigationButton({...input,button:{...input.button,type:'submit'}}),false);
 assert.equal(safeNavigationButton({...input,button:{...input.button,href:'https://other.lever.co/apply'}}),false);
 assert.ok(!observerUrl('https://user:secret@jobs.lever.co/a?token=secret&code=123').includes('secret'));
});
