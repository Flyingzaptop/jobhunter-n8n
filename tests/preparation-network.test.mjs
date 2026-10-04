import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {reviewedUploadRequest,draftNavigationWindow,reviewedDraftRequest} from '../services/browser-service/preparation-network.mjs';
test('draft step requires the exact named Next action and cannot authorize final Send or a different endpoint',()=>{
 const now=Date.now(),snapshot={url:'https://fixture.invalid/apply',forms:[]};
 const button={text:'Dalej',name:'stepAction',value:'Next',type:'submit',formAction:snapshot.url};
 const window=draftNavigationWindow(snapshot,button,now);assert.ok(window);
 const input={url:snapshot.url,method:'POST',body:Buffer.from('stepAction=Next&name=Example'),contentType:'application/x-www-form-urlencoded',window,now};
 assert.equal(reviewedDraftRequest(input),true);
 for(const override of [{body:Buffer.from('stepAction=Send')},{body:Buffer.from('stepAction=Next&action=submit')},{url:'https://fixture.invalid/submit'},{now:now+10000}])assert.equal(reviewedDraftRequest({...input,...override}),false);
 assert.equal(draftNavigationWindow(snapshot,{...button,text:'Wyślij',value:'Send'},now),null);
 assert.equal(draftNavigationWindow(snapshot,{...button,final_submit:true},now),null);
});
test('upload window permits only the exact verified PDF at a reviewed same-origin attachment route',()=>{
 const file=Buffer.from('%PDF-1.4 actual fixture');const now=Date.now();
 const input={url:'https://fixture.invalid/attachments',method:'POST',body:file,contentType:'application/pdf',now,window:{url:'https://fixture.invalid/apply',sha256:createHash('sha256').update(file).digest('hex'),expires_at:now+1000}};
 assert.equal(reviewedUploadRequest(input),true);
 for(const override of [{url:'https://other.invalid/attachments'},{url:'https://fixture.invalid/apply'},{url:'https://fixture.invalid/submit'},{body:Buffer.from('other')},{method:'PUT'},{now:now+1000}])assert.equal(reviewedUploadRequest({...input,...override}),false);
 const body=Buffer.concat([Buffer.from('--fixture\r\nContent-Disposition: form-data; name="resume"; filename="cv.pdf"\r\nContent-Type: application/pdf\r\n\r\n'),file,Buffer.from('\r\n--fixture--\r\n')]);
 assert.equal(reviewedUploadRequest({...input,body,contentType:'multipart/form-data; boundary=fixture'}),true);
});
