import test from 'node:test';import assert from 'node:assert/strict';
import {reviewFailureState} from '../services/core/form-review-recovery.mjs';
test('correction failure stays runnable by preparation instead of orphaning FILLING/PENDING',()=>{
 const state=reviewFailureState({applicationStatus:'FILLING',previous:{changes:[{field_label:'Location'}]},binding:'b',error:Error('COMBOBOX_CHOICE_NOT_CONFIRMED'),now:0});
 assert.equal(state.status,'CORRECTION_PENDING');assert.equal(state.error,'COMBOBOX_CHOICE_NOT_CONFIRMED');assert.equal(state.changes.length,1);
});
test('repeated model errors back off and stop hot-looping this application',()=>{
 let previous={};for(let i=0;i<3;i++)previous=reviewFailureState({applicationStatus:'READY_TO_SUBMIT',previous,binding:'b',error:Error('invalid output'),now:0});
 assert.equal(previous.status,'BLOCKED');assert.equal(previous.error_attempts,3);assert.ok(Date.parse(previous.next_retry_at)>=120000);
});
