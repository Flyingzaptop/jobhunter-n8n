import test from 'node:test';import assert from 'node:assert/strict';
import {confirmedSubmissionResult} from '../services/core/submission-result.mjs';
test('a callback that issued no request is a blocked submission, never a success or blind retry',()=>{
 const result={status:'MANUAL_TAKEOVER',reason:'SUBMIT_CALLBACK_NOT_DISPATCHED',browser_session_id:'s',transport_evidence:{state:'NOT_DISPATCHED',browser_session_id:'s'},screenshot_path:'evidence.png'};
 assert.equal(confirmedSubmissionResult(result).status,'MANUAL_TAKEOVER');
 assert.equal(confirmedSubmissionResult(result).confirmation_id,null);
 assert.equal(confirmedSubmissionResult({...result,transport_evidence:{state:'DISPATCH_STARTED',browser_session_id:'s'}}).status,'SUBMISSION_UNKNOWN');
 assert.equal(confirmedSubmissionResult({...result,browser_session_id:'different'}).status,'SUBMISSION_UNKNOWN');
});
