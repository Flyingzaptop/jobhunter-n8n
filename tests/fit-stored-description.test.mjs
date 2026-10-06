import test from 'node:test';
import assert from 'node:assert/strict';
import {canAssessStoredDescription} from '../services/core/relevance-queue.mjs';
test('unknown availability does not prevent FIT of substantive stored text',()=>{assert.equal(canAssessStoredDescription({availability_status:'UNKNOWN',description_text:'x'.repeat(120)}),true);assert.equal(canAssessStoredDescription({availability_status:'CLOSED',description_text:'x'.repeat(200)}),false);assert.equal(canAssessStoredDescription({availability_status:'UNKNOWN',description_text:'short'}),false);});
