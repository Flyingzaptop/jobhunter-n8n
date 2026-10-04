import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { Repository } from '../services/core/repository.mjs';
import { answerApplicationQuestion,boundedAnswer,questionEligibility,dispatchQuestionAnswer,recoverPendingQuestionAnswers,persistPendingApplicationQuestion } from '../services/core/hitl.mjs';
import { activeProfileDigest,digest,formBinding,validateReviewContext,prepareApplicationReview,approveApplicationReview,revokeApplicationReview,consumeApplicationReview } from '../services/dashboard/review-gates.mjs';
import { createDashboard } from '../services/dashboard/server.mjs';
import {chromium} from 'playwright';

const profile={profile_id:'isolated-hitl-regression',onboarding:{legal_name:'Regression only'}};
function context() {
  const id=randomUUID(),cv=randomUUID(),session=randomUUID();
  return {profile,application:{application_id:randomUUID(),candidate_profile_id:profile.profile_id,job_id:id,cv_id:cv,status:'READY_TO_SUBMIT',last_state:{browser_session_id:session}},job:{job_id:id,content_hash:digest('isolated job'),availability_status:'OPEN',last_verified_open_at:new Date()},cv:{cv_id:cv,job_id:id,profile_version:activeProfileDigest(profile),sha256:'verified-cv-hash',manifest_json:{application_eligible:true,profile_hash:activeProfileDigest(profile),job_content_hash:digest('isolated job')},qa_json:{pass:true,claims:{pass:true},identity:{pass:true},pdf:{pass:true}}},snapshot:{browser_session_id:session,url:'https://example.invalid/form',fingerprint:'stable-fingerprint',fields:[{selector:'#email',name:'email',type:'email',visible:true,required:true,value:'test@example.invalid'}],validation_errors:[],captcha:false,forms:[],buttons:[]}};
}
test('HITL validation refuses unknown, unbounded, secret and stale answers',()=>{
  assert.equal(boundedAnswer(' My explicit answer '),'My explicit answer');
  for(const value of ['',null,{},'x'.repeat(2001),'UNKNOWN','not sure','a\u0000b'])assert.throws(()=>boundedAnswer(value));
  const request=randomUUID(),q={telegram_request_id:request},a={status:'NEEDS_USER',candidate_profile_id:'active',last_state:{pending_question:{request_id:request,type:'MISSING_FACT',question:'Start date'}}};
  assert.equal(questionEligibility(q,a,'active'),null);
  for(const word of ['CAPTCHA','password','OTP','authentication_code','hasło','passport number'])assert.equal(questionEligibility({...q,raw_question:word},a,'active'),'SECURITY_QUESTION_REQUIRES_MANUAL_TAKEOVER');
  assert.equal(questionEligibility(q,{...a,status:'SUBMISSION_UNKNOWN'},'active'),'APPLICATION_NOT_WAITING_FOR_ANSWER');
  assert.equal(questionEligibility(q,a,'different'),'QUESTION_NOT_FOR_ACTIVE_PROFILE');
  assert.equal(questionEligibility(q,{...a,last_state:{pending_question:{request_id:randomUUID()}}},'active'),'QUESTION_CORRELATION_STALE');
});
test('review digests bind actual answers and omit transient observer operations',()=>{
  const c=context();validateReviewContext(c);
  const before=digest(formBinding(c.snapshot));
  assert.equal(before,digest(formBinding({...c.snapshot,current_action:{operation:'observe-image',started_at:'new'}})));
  assert.notEqual(before,digest(formBinding({...c.snapshot,fields:[{...c.snapshot.fields[0],value:'changed@example.invalid'}]})));
  for(const mutation of [c=>c.application.status='SUBMISSION_UNKNOWN',c=>c.snapshot.captcha=true,c=>c.cv.qa_json.identity.pass=false,c=>c.cv.profile_version='stale',c=>c.job.last_verified_open_at='invalid',c=>c.snapshot.text='Use of AI may disqualify your application',c=>c.snapshot.fields[0].value='']){const changed=context();mutation(changed);assert.throws(()=>validateReviewContext(changed));}
});
test('question wording, visibility and disabled changes invalidate the exact form binding',()=>{
  const c=context(),before=digest(formBinding(c.snapshot));
  for(const patch of [{label:'Different legal declaration'},{visible:false},{disabled:true}])assert.notEqual(digest(formBinding({...c.snapshot,fields:[{...c.snapshot.fields[0],...patch}]})),before);
  const original={...c.snapshot,buttons:[{selector:'#submit',text:'Submit application',type:'submit',href:'https://example.invalid/submit',formAction:'https://example.invalid/submit',formMethod:'post'}],forms:[{selector:'#apply',action:'https://example.invalid/submit',method:'post'}]};
  const initial=digest(formBinding(original));
  for(const patch of [{text:'Accept binding contract'},{type:'button'},{selector:'#different-submit'},{href:'https://example.invalid/another'},{formAction:'https://example.invalid/another'},{formMethod:'get'}])assert.notEqual(digest(formBinding({...original,buttons:[{...original.buttons[0],...patch}]})),initial);
  assert.notEqual(digest(formBinding({...original,forms:[{...original.forms[0],action:'https://example.invalid/changed-destination'}]})),initial);
});
test('required radio groups need an actual checked option rather than a nonempty value',()=>{
  const c=context();
  c.snapshot.fields=[{selector:'#radio-yes',name:'legal_confirmation',type:'radio',required:true,visible:true,disabled:false,value:'yes',checked:false,form_selector:'#apply'},{selector:'#radio-no',name:'legal_confirmation',type:'radio',required:true,visible:true,disabled:false,value:'no',checked:false,form_selector:'#apply'}];
  assert.throws(()=>validateReviewContext(c),/REQUIRED_FORM_ANSWER_MISSING/);
  c.snapshot.fields[1].checked=true;validateReviewContext(c);
  c.snapshot.fields[1].form_selector='#different-form';assert.throws(()=>validateReviewContext(c),/REQUIRED_FORM_ANSWER_MISSING/);
});
test('full CV QA cannot override absent eligibility, policy blockers or stale source/profile hashes',()=>{
  for(const mutation of [c=>delete c.cv.manifest_json.application_eligible,c=>c.cv.manifest_json.application_policy_blocker='EMPLOYER_NO_AI_ATTESTATION',c=>delete c.cv.manifest_json.profile_hash,c=>c.cv.manifest_json.job_content_hash='outdated',c=>delete c.job.content_hash]){const c=context();mutation(c);assert.throws(()=>validateReviewContext(c));}
});

test('actual PostgreSQL: one correlated answer, authenticated review gate, stale digests and ten-slot cap', {skip:!process.env.DATABASE_URL,timeout:60000}, async t=>{
  const repo=new Repository(),admin=repo.pool,schema='hitl_gate_test_'+randomUUID().replaceAll('-','');
  assert.match(schema,/^hitl_gate_test_[a-f0-9]{32}$/);
  await admin.query(`CREATE SCHEMA ${schema}`);
  repo.pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`,max:8});
  const artifactRoot=path.resolve('data','hitl-gate-regression'),directory=path.join(artifactRoot,randomUUID());
  if(!directory.startsWith(artifactRoot+path.sep))throw new Error('Unsafe test artifact directory');
  await mkdir(directory,{recursive:true});
  t.after(async()=>{await repo.pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();if(!directory.startsWith(artifactRoot+path.sep))throw new Error('Unsafe cleanup directory');await rm(directory,{recursive:true,force:true});});
  await repo.migrate();
  const pdf=Buffer.from('%PDF-1.4\nIsolated regression artifact; never an employer CV.\n%%EOF');
  const pdfPath=path.join(directory,'regression.pdf');await writeFile(pdfPath,pdf);
  async function seed(status='NEEDS_USER',kind='MISSING_FACT') {
    const job=randomUUID(),application=randomUUID(),cv=randomUUID(),question=randomUUID(),request=randomUUID(),session=randomUUID();
    await repo.pool.query("INSERT INTO jobs(job_id,canonical_url,application_url,company,title,description_text,content_hash,availability_status,last_verified_open_at)VALUES($1,$2,$2,'REGRESSION ONLY','Isolated auth/gate test','No real employer or market evidence',$3,'OPEN',now())",[job,`https://example.invalid/${job}`,digest('isolated job')]);
    const qa={pass:true,claims:{pass:true},identity:{pass:true},pdf:{pass:true}};
    await repo.pool.query("INSERT INTO cv_versions(cv_id,job_id,profile_version,template_version,model,pdf_path,html_path,sha256,qa_json,manifest_json)VALUES($1,$2,$3,'regression','none',$4,'not-used',$5,$6,$7)",[cv,job,activeProfileDigest(profile),pdfPath,digest(pdf),qa,{application_eligible:true,profile_hash:activeProfileDigest(profile),job_content_hash:digest('isolated job')}]);
    const state={browser_session_id:session,...(status==='NEEDS_USER'?{pending_question:{request_id:request,type:kind,field_type:'text',question:'Exact regression question'}}:{})};
    await repo.pool.query('INSERT INTO applications(application_id,candidate_profile_id,job_id,cv_id,status,last_state)VALUES($1,$2,$3,$4,$5,$6)',[application,profile.profile_id,job,cv,status,state]);
    if(status==='NEEDS_USER')await repo.pool.query("INSERT INTO application_questions(question_id,application_id,normalized_question,raw_question,telegram_request_id)VALUES($1,$2,'Exact regression question','Exact regression question',$3)",[question,application,request]);
    const snapshot={browser_session_id:session,url:`https://example.invalid/${job}/apply`,fingerprint:'fixed-safe-form',fields:[{selector:'#start',name:'start_date',type:'text',visible:true,required:true,value:'Provided answer'}],validation_errors:[],captcha:false,forms:[{selector:'#apply',action:`https://example.invalid/${job}/submit`,method:'post'}],buttons:[{selector:'#submit',text:'Submit application',type:'submit',formAction:`https://example.invalid/${job}/submit`,formMethod:'post',visible:true,disabled:false}],uploaded_file_hashes:[]};
    return {job,application,cv,question,request,snapshot};
  }
  await t.test('dashboard and Telegram race produces one answer and one durable dispatch receipt',async()=>{
    const seeded=await seed();
    const results=await Promise.allSettled(['USER_DASHBOARD','USER_TELEGRAM'].map(source=>answerApplicationQuestion(repo,{questionId:seeded.question,correlationId:seeded.request,answer:'User supplied answer',source,profileId:profile.profile_id})));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
    const stored=(await repo.pool.query('SELECT * FROM application_questions WHERE question_id=$1',[seeded.question])).rows[0];assert.equal(stored.answer,'User supplied answer');assert.equal(stored.reusable,false);
    assert.equal((await repo.pool.query('SELECT * FROM application_answer_receipts WHERE question_id=$1',[seeded.question])).rowCount,1);
    const events=(await repo.pool.query("SELECT payload_json FROM events WHERE entity_id=$1 AND event_type='HITL_ANSWER_ACCEPTED'",[seeded.application])).rows;assert.equal(events.length,1);assert.equal(JSON.stringify(events).includes('User supplied answer'),false);
    let calls=0;await Promise.all([dispatchQuestionAnswer(repo,seeded.question,async()=>{calls++;}),dispatchQuestionAnswer(repo,seeded.question,async()=>{calls++;})]);assert.equal(calls,1);
  });
  await t.test('secret questions and foreign/stale applications cannot be answered',async()=>{
    const seeded=await seed('NEEDS_USER','CAPTCHA');
    for(const override of [{profileId:'foreign'},{correlationId:randomUUID()},{}])await assert.rejects(answerApplicationQuestion(repo,{questionId:seeded.question,correlationId:seeded.request,answer:'123456',source:'USER_DASHBOARD',profileId:profile.profile_id,...override}));
    assert.equal((await repo.pool.query('SELECT answered_at FROM application_questions WHERE question_id=$1',[seeded.question])).rows[0].answered_at,null);
  });
  await t.test('pending correlation persists without Telegram and ambiguous dispatch never retries',async()=>{
    const seeded=await seed();
    await repo.pool.query('DELETE FROM application_questions WHERE question_id=$1',[seeded.question]);
    await repo.pool.query("UPDATE applications SET last_state=last_state #- '{pending_question,request_id}' WHERE application_id=$1",[seeded.application]);
    const question=await persistPendingApplicationQuestion(repo,{applicationId:seeded.application,rawQuestion:'Exact regression question'});
    const duplicate=await persistPendingApplicationQuestion(repo,{applicationId:seeded.application,rawQuestion:'Exact regression question'});
    assert.equal(question.question_id,duplicate.question_id);assert.equal(question.telegram_message_id,null);
    await answerApplicationQuestion(repo,{questionId:question.question_id,correlationId:question.telegram_request_id,answer:'My answer without Telegram',source:'USER_DASHBOARD',profileId:profile.profile_id});
    let calls=0;const dispatch=async()=>{calls++;throw new Error('External dispatch ambiguous');};
    const recovered=await recoverPendingQuestionAnswers(repo,dispatch);assert.ok(recovered.attention.some(row=>row.question_id===question.question_id));
    await recoverPendingQuestionAnswers(repo,dispatch);assert.equal(calls,1);
  });
  await t.test('real HTTP mutation enforces authentication, CSRF, question scope and explicit confirmation',async()=>{
    const seeded=await seed(),password='isolated-password-'+randomUUID(),app=createDashboard({repository:repo,password,port:0,profileProvider:async()=>profile,answerDispatch:async()=>({status:'REGRESSION_NO_BROWSER_ACTION'})});await app.start();
    try {
      const base=`http://127.0.0.1:${app.server.address().port}`,route=`/api/hitl/questions/${seeded.question}/answer`,valid={answer:'Explicit applicant answer',confirmed:true,expected_request_id:seeded.request};
      const post=(route,body,headers={})=>fetch(base+route,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
      assert.equal((await post(route,valid)).status,401);
      const login=await post('/api/auth/login',{password}),cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).data.csrf_token,headers={cookie,'x-csrf-token':csrf};
      assert.equal((await post(route,valid,{cookie})).status,403);
      assert.equal((await fetch(base+route,{headers:{cookie}})).status,405);
      assert.equal((await post(route,{...valid,application_id:seeded.application},headers)).status,400);
      assert.equal((await post(route,{...valid,confirmed:false},headers)).status,400);
      assert.equal((await post(route,valid,headers)).status,200);
      assert.equal((await post(route,valid,headers)).status,409);
    } finally {await new Promise(resolve=>app.server.close(resolve));}
  });
  await t.test('review preparation and approval do not submit and stale form changes invalidate approval',async()=>{
    const seeded=await seed('READY_TO_SUBMIT'),browser={call:async()=>seeded.snapshot};
    const prepared=await prepareApplicationReview(repo,seeded.application,profile,browser);assert.equal(prepared.review_only,true);assert.equal(prepared.real_submit_enabled,false);
    const approved=await approveApplicationReview(repo,seeded.application,prepared.gate.approval_id,prepared.gate.binding_digest,profile,browser);assert.equal(approved.gate.status,'APPROVED');
    assert.equal((await repo.pool.query('SELECT status FROM applications WHERE application_id=$1',[seeded.application])).rows[0].status,'READY_TO_SUBMIT');
    await assert.rejects(consumeApplicationReview(repo,seeded.application,prepared.gate.approval_id,profile,browser),/PRODUCTION_EVIDENCE_GATE_REQUIRED/);
    seeded.snapshot.fields[0].value='changed after review';
    await assert.rejects(consumeApplicationReview(repo,seeded.application,prepared.gate.approval_id,profile,browser,{assertProductionGate:async()=>true}),/APPROVED_REVIEW_REQUIRED_OR_STALE/);
    seeded.snapshot.fields[0].value='Provided answer';
    await consumeApplicationReview(repo,seeded.application,prepared.gate.approval_id,profile,browser,{assertProductionGate:async()=>true});
    await assert.rejects(consumeApplicationReview(repo,seeded.application,prepared.gate.approval_id,profile,browser,{assertProductionGate:async()=>true}));
    await assert.rejects(prepareApplicationReview(repo,seeded.application,profile,browser),/APPLICATION_REVIEW_ALREADY_CONSUMED/);
  });
  await t.test('persisted approval cannot accept changed question wording or Submit destination',async()=>{
    const seeded=await seed('READY_TO_SUBMIT'),browser={call:async()=>seeded.snapshot};
    const prepared=await prepareApplicationReview(repo,seeded.application,profile,browser);
    seeded.snapshot.fields[0].label='New legal question after preparation';
    await assert.rejects(approveApplicationReview(repo,seeded.application,prepared.gate.approval_id,prepared.gate.binding_digest,profile,browser),/REVIEW_STALE_OR_ALREADY_APPROVED/);
    delete seeded.snapshot.fields[0].label;
    const destination=seeded.snapshot.buttons[0].formAction;
    seeded.snapshot.buttons[0].formAction='https://example.invalid/changed-submit-destination';
    await assert.rejects(approveApplicationReview(repo,seeded.application,prepared.gate.approval_id,prepared.gate.binding_digest,profile,browser),/REVIEW_STALE_OR_ALREADY_APPROVED/);
    seeded.snapshot.buttons[0].formAction=destination;seeded.snapshot.forms[0].action='https://example.invalid/changed-form-action';
    await assert.rejects(approveApplicationReview(repo,seeded.application,prepared.gate.approval_id,prepared.gate.binding_digest,profile,browser),/REVIEW_STALE_OR_ALREADY_APPROVED/);
    await revokeApplicationReview(repo,seeded.application,prepared.gate.approval_id,profile);
    assert.equal((await repo.pool.query('SELECT status FROM applications WHERE application_id=$1',[seeded.application])).rows[0].status,'READY_TO_SUBMIT');
  });
  await t.test('compiled React HITL flow requires explicit review confirmation and stores plain user text once',async()=>{
    const seeded=await seed(),password='isolated-ui-'+randomUUID(),app=createDashboard({repository:repo,password,port:0,profileProvider:async()=>profile,answerDispatch:async()=>({status:'REGRESSION_NO_BROWSER_ACTION'})});await app.start();
    const browser=await chromium.launch({headless:true}),page=await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${app.server.address().port}/#human-review`);
      await page.getByLabel('Dashboard password',{exact:true}).fill(password);await page.getByRole('button',{name:'Open control center'}).click();
      const card=page.locator(`article[data-question-id="${seeded.question}"]`);await card.waitFor();
      const answer='<script>untrusted text remains applicant text</script>';
      await card.locator('textarea').fill(answer);await card.getByRole('button',{name:'Review answer →'}).click();
      assert.equal(await card.locator('.answer-preview').innerText(),answer);assert.equal(await card.locator('.answer-preview script').count(),0);
      const save=card.getByRole('button',{name:'Save confirmed answer'});assert.equal(await save.isDisabled(),true);
      await card.locator('.confirmation input').check();assert.equal(await save.isEnabled(),true);await save.click();
      await card.locator('.answer-saved').waitFor();
      const stored=(await repo.pool.query('SELECT answer,answer_source FROM application_questions WHERE question_id=$1',[seeded.question])).rows[0];
      assert.equal(stored.answer,answer);assert.equal(stored.answer_source,'USER_DASHBOARD');
      assert.equal((await repo.pool.query('SELECT count(*)::int AS n FROM application_answer_receipts WHERE question_id=$1',[seeded.question])).rows[0].n,1);
    } finally {await browser.close();await new Promise(resolve=>app.server.close(resolve));}
  });
  await t.test('campaign permits exactly ten specific reviews, rejects eleventh, and revoke releases only an unconsumed slot',async()=>{
    let latest;
    for(let i=1;i<10;i++){const seeded=await seed('READY_TO_SUBMIT'),browser={call:async()=>seeded.snapshot};const prepared=await prepareApplicationReview(repo,seeded.application,profile,browser);await approveApplicationReview(repo,seeded.application,prepared.gate.approval_id,prepared.gate.binding_digest,profile,browser);latest={seeded,browser,prepared};}
    const seeded=await seed('READY_TO_SUBMIT'),browser={call:async()=>seeded.snapshot},prepared=await prepareApplicationReview(repo,seeded.application,profile,browser);
    await assert.rejects(approveApplicationReview(repo,seeded.application,prepared.gate.approval_id,prepared.gate.binding_digest,profile,browser),/TEN_APPLICATION_APPROVAL_LIMIT_REACHED/);
    await revokeApplicationReview(repo,latest.seeded.application,latest.prepared.gate.approval_id,profile);
    await approveApplicationReview(repo,seeded.application,prepared.gate.approval_id,prepared.gate.binding_digest,profile,browser);
  });
});
