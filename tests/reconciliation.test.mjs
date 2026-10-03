import test from 'node:test';
import assert from 'node:assert/strict';
import { reconciliationActions,reconcile } from '../services/core/reconciliation.mjs';

test('reconciliation identifies stalled work and unanswered questions without scheduling Submit',()=>{
 const old='2026-10-03T06:00:00Z',now=new Date('2026-10-03T10:00:00Z');
 const actions=reconciliationActions({now,applications:[{application_id:'fill',status:'FILLING',updated_at:old},{application_id:'unknown',status:'SUBMISSION_UNKNOWN',updated_at:old},{application_id:'wait',status:'NEEDS_USER',updated_at:old}],questions:[{question_id:'q',application_id:'other',created_at:old,answered_at:null}],jobs:[{job_id:'j',content_hash:'h'}],cvs:[{cv_id:'cv',created_at:old}]});
 assert.deepEqual(actions.map(a=>a.code),['STUCK_APPLICATION','SUBMISSION_RECONCILIATION_REQUIRED','MISSING_PENDING_QUESTION','STALE_PENDING_QUESTION','JOB_AWAITING_ANALYSIS','UNREFERENCED_CV_REVIEW']);assert(actions.every(a=>a.automatic_submit===false));
 assert.deepEqual(reconciliationActions({now,applications:[{application_id:'recent',status:'FILLING',updated_at:now.toISOString()}]}),[]);
});

test('reconciliation emits deduplicated audit recommendations, detects expired CAPTCHA session and missing PDF, never mutates states',async()=>{
 const events=[],now=new Date('2026-10-03T10:00:00Z'),old='2026-10-03T06:00:00Z';let writes=0;
 const repository={pool:{query:async(sql,params)=>{
   if(sql.startsWith('SELECT * FROM applications'))return {rows:[{application_id:'app',status:'CAPTCHA_WAIT',updated_at:old,last_state:{browser_session_id:'expired'}}]};
   if(sql.startsWith('SELECT question_id'))return {rows:[{question_id:'q',application_id:'app',created_at:old,answered_at:null}]};
   if(sql.startsWith('SELECT j.job_id'))return {rows:[]};
   if(sql.startsWith('SELECT c.cv_id'))return {rows:[{cv_id:'cv',created_at:old,pdf_path:'C:/nonexistent-fixture-artifact.pdf'}]};
   if(sql.startsWith('SELECT 1 FROM events'))return {rows:events.filter(e=>e.entity_type===params[0]&&e.entity_id===params[1]&&e.evidence_hash===params[2])};
   writes++;throw new Error('Unexpected mutation '+sql);
 }},event:async(type,id,event,payload)=>events.push(payload)};
 const browser={call:async()=>{throw new Error('SESSION_NOT_FOUND');}};
 const first=await reconcile(repository,{now,browser});assert.equal(first.new_events,4);assert(first.actions.some(a=>a.code==='BROWSER_SESSION_EXPIRED'));assert(first.actions.some(a=>a.code==='CV_ARTIFACT_MISSING'));assert.equal(first.automatic_submissions,0);
 const second=await reconcile(repository,{now,browser});assert.equal(second.new_events,0);assert.equal(writes,0);
});
