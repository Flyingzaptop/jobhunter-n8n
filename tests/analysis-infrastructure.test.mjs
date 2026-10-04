import test from 'node:test';
import assert from 'node:assert/strict';
import {retryPlan} from '../services/core/analysis-retry.mjs';
test('local model configuration and deadline failures never discard a vacancy as bad output',()=>{
 const now=new Date('2026-10-04T00:00:00Z');
 for(const code of ['INPUT_BUDGET_EXCEEDED','NATIVE_TOKEN_COUNT_UNVERIFIED','LMSTUDIO_MODEL_UNVERIFIED','INFERENCE_TIMEOUT']){
  const plan=retryPlan({code},100,{now});assert.equal(plan.retryable,true);assert.equal(plan.consumes_attempt,false);assert.equal(plan.next_retry_at,'2026-10-04T00:05:00.000Z');
 }
 const semantic=retryPlan({code:'SEMANTIC_VALIDATION_FAILED'},3,{now});assert.equal(semantic.retryable,false);assert.equal(semantic.consumes_attempt,true);
});
