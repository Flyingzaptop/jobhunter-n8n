import test from 'node:test';
import assert from 'node:assert/strict';
import {currentPreparationPolicy} from '../services/core/preparation-policy.mjs';
import {CV_V2_VERSION} from '../services/core/cv-v2.mjs';
test('preparation does not reuse a generic CV or a now-rejected analysis',()=>{
 const job={title:'IT Support',country:'PL',location:'Wroclaw',work_mode:'REMOTE'};
 const profile={candidate:{base_location:{city:'Wroclaw',country:'Poland'},eu_citizen:true}};
 const analysis={decision:'REVIEW',work_format:{mode:'REMOTE',work_from_poland_allowed:true,hire_route:'UNKNOWN'}};
 const cv={template_version:CV_V2_VERSION,qa_json:{tailoring:{pass:true}}};
 assert.equal(currentPreparationPolicy({job,profile,analysis,cv}).pass,true);
 assert.equal(currentPreparationPolicy({job,profile,analysis,cv:{...cv,template_version:'cv-factory-v2.0'}}).reason,'CURRENT_TARGET_TAILORED_CV_REQUIRED');
 assert.equal(currentPreparationPolicy({job,profile,analysis:{...analysis,decision:'REJECT'},cv}).pass,false);
});
