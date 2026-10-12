import test from 'node:test';import assert from 'node:assert/strict';import {confirmedSubmissionResult} from '../services/core/submission-result.mjs';import {assertAutonomousTarget} from '../services/core/autonomous-authorization.mjs';
test('explicit 90-day employer denial with screenshot is not an uncertain success and is not retried',()=>{
 const result={status:'SUBMISSION_UNKNOWN',screenshot_path:'denial.png',validation_errors:["We couldn't submit your application. You have applied for a position in this domain within the last 90 days, you cannot submit an application for this position"]};
 assert.equal(confirmedSubmissionResult(result).status,'SKIPPED');assert.equal(confirmedSubmissionResult({...result,screenshot_path:null}).status,'SUBMISSION_UNKNOWN');assert.equal(confirmedSubmissionResult({...result,validation_errors:['Network error']}).status,'SUBMISSION_UNKNOWN');
});
test('controlled validation cannot authorize another application or an empty allowlist',()=>{
 assert.doesNotThrow(()=>assertAutonomousTarget({mode:'CONTROLLED_VALIDATION',allowed_application_ids:['one']},'one'));
 assert.throws(()=>assertAutonomousTarget({mode:'CONTROLLED_VALIDATION',allowed_application_ids:['one']},'two'));
 assert.throws(()=>assertAutonomousTarget({mode:'CONTROLLED_VALIDATION',allowed_application_ids:[]},'one'));
});
