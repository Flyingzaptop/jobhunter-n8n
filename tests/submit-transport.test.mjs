import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {recordSubmitTransport,undispatchedCaptcha} from '../services/browser-service/submit-transport.mjs';
import {confirmedSubmissionResult} from '../services/core/submission-result.mjs';
test('only an observed CAPTCHA with durable zero-dispatch evidence can wait safely',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'jh-transport-'));
 try{
  const session={id:'session',application_id:'application'};
  await recordSubmitTransport(session,root,'NOT_DISPATCHED');
  assert.equal(undispatchedCaptcha(session,{captcha:true}),true);
  const result={status:'MANUAL_TAKEOVER',reason:'INTERACTIVE_CAPTCHA',captcha:true,browser_session_id:'session',transport_evidence:session.submitTransport};
  assert.equal(confirmedSubmissionResult(result).status,'MANUAL_TAKEOVER');
  assert.equal(confirmedSubmissionResult({...result,browser_session_id:'another'}).status,'SUBMISSION_UNKNOWN');
  await recordSubmitTransport(session,root,'DISPATCH_STARTED');
  assert.equal(undispatchedCaptcha(session,{captcha:true}),false);
  assert.equal(confirmedSubmissionResult({...result,transport_evidence:session.submitTransport}).status,'SUBMISSION_UNKNOWN');
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'session-submit-transport.json'),'utf8')).state,'DISPATCH_STARTED');
  assert.equal(undispatchedCaptcha({}, {captcha:true}),false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
