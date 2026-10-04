import test from 'node:test';import assert from 'node:assert/strict';
import {issueSubmitCapability,verifySubmitCapability} from '../services/browser-service/submit-capability.mjs';
test('confirmed submit binds the exact application, browser, answers and CV and expires without global enable',()=>{
 const secret='isolated-secret-for-capability-test',now=Date.now();
 const snapshot={browser_session_id:'session-a',url:'https://fixture.invalid/apply',fingerprint:'f',fields:[{name:'email',value:'a@example.invalid'}],buttons:[],uploaded_file_hashes:[{sha256:'cv-one'}]};
 const token=issueSubmitCapability({secret,approvalId:'approval',applicationId:'application',snapshot,now});
 assert.equal(verifySubmitCapability(token,{secret,applicationId:'application',snapshot,now}).source,'USER_DASHBOARD');
 for(const changed of [{...snapshot,browser_session_id:'other'},{...snapshot,fields:[{name:'email',value:'b@example.invalid'}]},{...snapshot,uploaded_file_hashes:[{sha256:'cv-two'}]}])
  assert.throws(()=>verifySubmitCapability(token,{secret,applicationId:'application',snapshot:changed,now}),/STALE/);
 assert.throws(()=>verifySubmitCapability(token,{secret,applicationId:'other',snapshot,now}),/WRONG_APPLICATION/);
 assert.throws(()=>verifySubmitCapability(token,{secret,applicationId:'application',snapshot,now:now+120000}),/STALE/);
 assert.throws(()=>verifySubmitCapability(token+'x',{secret,applicationId:'application',snapshot,now}),/INVALID/);
});
