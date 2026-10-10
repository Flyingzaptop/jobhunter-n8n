import test from 'node:test';import assert from 'node:assert/strict';import {transientApplicationError} from '../services/core/application-retry.mjs';
test('transient browser failures get bounded retries; factual/policy failures do not loop',()=>{
 for(const reason of ['page.evaluate: Execution context was destroyed','locator.waitFor: Timeout 7000ms exceeded','BROWSER_CAPACITY_RETRY']){
  assert.equal(transientApplicationError(Error(reason),0),true);assert.equal(transientApplicationError(Error(reason),3),false);
 }
 assert.equal(transientApplicationError(Error('PROFILE_CHANGED_REQUIRES_FRESH_FORM')),false);
 assert.equal(transientApplicationError(Error('APPLICANT_LOCATION_EXCLUDES_REQUIRED_BASE')),false);
});
