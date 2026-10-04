import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmedSubmissionResult} from '../services/core/submission-result.mjs';
test('confirmed submit requires matching page and network evidence, not just an identifier',()=>{
 for(const result of [null,{status:'SUBMITTED',confirmation_id:'123'},{status:'SUBMITTED',confirmation_id:'123',confirmation_evidence:'PAGE_ONLY'},{status:'SUBMISSION_UNKNOWN',confirmation_id:'123',confirmation_evidence:'NETWORK_AND_PAGE'},{status:'SUBMITTED',confirmation_id:' ',confirmation_evidence:'NETWORK_AND_PAGE'}]){
  assert.equal(confirmedSubmissionResult(result).status,'SUBMISSION_UNKNOWN');
  assert.equal(confirmedSubmissionResult(result).confirmation_id,null);
 }
 assert.equal(confirmedSubmissionResult({status:'SUBMITTED',confirmation_id:'123',confirmation_evidence:'NETWORK_AND_PAGE'}).status,'SUBMITTED');
});
