import test from 'node:test';import assert from 'node:assert/strict';
import {checkPdfGeometry,checkCvBindings} from '../services/core/cv-independent-qa.mjs';
import {createHash} from 'node:crypto';import {canonicalAnalysisHash} from '../services/core/evidence-hash.mjs';
const page={width:595,height:842,boxes:[{text:'Readable factual text',x:40,y:40,width:180,height:10}]};
test('independent PDF geometry rejects clipping, tiny text and overlap without accepting page count alone',()=>{
 assert.equal(checkPdfGeometry([page]).pass,true);
 assert.ok(checkPdfGeometry([{...page,boxes:[{...page.boxes[0],x:590}]}]).reasons.includes('TEXT_OUTSIDE_PAPER'));
 assert.ok(checkPdfGeometry([{...page,boxes:[{...page.boxes[0],height:1}]}]).reasons.includes('ILLEGIBLE_TEXT_GEOMETRY'));
 assert.ok(checkPdfGeometry([{...page,boxes:[page.boxes[0],{...page.boxes[0],x:45}]}]).reasons.includes('TEXT_RECTANGLE_OVERLAP'));
});
test('independent QA refuses excess pages and blank pages',()=>{
 assert.deepEqual(checkPdfGeometry([page,page,page]).reasons,['PDF_PAGE_COUNT']);
 assert.ok(checkPdfGeometry([{...page,boxes:[]}]).reasons.includes('PDF_PAGE_NO_TEXT'));
});
test('registration evidence binds current profile, source and canonical latest analysis',()=>{
 const profile={profile_id:'fixture'},profileHash=createHash('sha256').update(JSON.stringify(profile)).digest('hex');
 const job={job_id:'job',content_hash:'v1',availability_status:'OPEN'};
 const analysis={decision:'STRETCH',overall_fit:55,requirements:[{}],hard_blockers:[],profile_hash:profileHash,job_content_hash:'v1'};
 const manifest={job_id:'job',status:'PASS',profile_hash:profileHash,profile_version:profileHash,job_content_hash:'v1',
  analysis_hash:canonicalAnalysisHash(analysis),application_eligible:true,qa:{pass:true,claims:{pass:true},identity:{pass:true},pdf:{pass:true}}};
 assert.equal(checkCvBindings({manifest,job,profile,analysis}).pass,true);
 const pending={...manifest,source_verification_required:true,application_eligible:false};
 assert.equal(checkCvBindings({manifest:pending,job:{...job,availability_status:'UNKNOWN'},profile,analysis}).pass,true);
 assert.equal(checkCvBindings({manifest:pending,job:{...job,availability_status:'CLOSED'},profile,analysis}).pass,false);
 assert.equal(checkCvBindings({manifest,job:{...job,availability_status:'UNKNOWN'},profile,analysis}).pass,false);
 assert.ok(checkCvBindings({manifest,job:{...job,content_hash:'v2'},profile,analysis}).reasons.includes('CV_SOURCE_CHANGED'));
 assert.ok(checkCvBindings({manifest,job:{...job,availability_status:'CLOSED'},profile,analysis}).reasons.includes('CURRENT_OFFICIAL_SOURCE_NOT_OPEN'));
 assert.ok(checkCvBindings({manifest,job,profile:{...profile,new_fact:1},analysis}).reasons.includes('CV_PROFILE_CHANGED'));
 assert.ok(checkCvBindings({manifest,job,profile,analysis:{...analysis,overall_fit:56}}).reasons.includes('CV_ANALYSIS_CHANGED'));
 assert.ok(checkCvBindings({manifest:{...manifest,qa:{...manifest.qa,claims:{pass:false}}},job,profile,analysis}).reasons.includes('EXISTING_CV_QA_REQUIRED'));
});
