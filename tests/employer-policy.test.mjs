import test from 'node:test';
import assert from 'node:assert/strict';
import {employerAutomationPolicy} from '../services/core/employer-policy.mjs';
test('interview-only AI restrictions do not invent a ban on truthful CV preparation, while application bans remain blocked',()=>{
 const interview="Waymo prohibits unauthorized outside assistance during the interview process. This includes artificial intelligence (AI) tools, unless authorized. By submitting this application, you acknowledge these guidelines.";
 assert.equal(employerAutomationPolicy({fields:[{label:interview},{label:'I certify the information in my resume/CV is true and correct.'}]}),null);
 assert.equal(employerAutomationPolicy({text:interview+'\nI certify the information in my resume/CV is true and correct.'}),null);
 assert.equal(employerAutomationPolicy({fields:[{label:'During this application process I agree to use only my own words. AI generated content will disqualify my application.'}]}),'HUMAN_AUTHORED_ONLY');
 assert.equal(employerAutomationPolicy({text:'AI generated content in your CV is not permitted.'}),'HUMAN_AUTHORED_ONLY');
});
