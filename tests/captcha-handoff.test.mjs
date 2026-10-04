import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {Repository} from '../services/core/repository.mjs';
import {enqueueCaptchaHandoff,deliverCaptchaHandoff,drainCaptchaHandoffs} from '../services/core/captcha-handoff.mjs';
import {captureCaptchaImage} from '../services/browser-service/captcha-image.mjs';
import {answerApplicationQuestion} from '../services/core/hitl.mjs';
const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
test('CAPTCHA image capture crops one bounded visible element, masks all form controls and never captures full page',async()=>{
 let screenshotOptions;
 const mask={privateFormControls:true},target={isVisible:async()=>true,boundingBox:async()=>({width:302,height:78}),evaluate:async()=>true,screenshot:async opts=>{screenshotOptions=opts;return png;}};
 const oversized={...target,boundingBox:async()=>({width:1600,height:1000})};
 const page={locator:()=>({count:async()=>2,nth:i=>i?target:oversized}),frames:()=>[{locator:selector=>{assert.equal(selector,'input,textarea,select');return mask;}}],screenshot:()=>{throw new Error('Full-page capture forbidden');}};
 const result=await captureCaptchaImage(page);assert.equal(result.scope,'CAPTCHA_ELEMENT_CROP');assert.equal(result.redacted,true);assert.equal(result.persisted,false);assert.deepEqual(screenshotOptions.mask,[mask]);assert.equal(screenshotOptions.fullPage,undefined);
 const hidden={...page,locator:()=>({count:async()=>1,nth:()=>({...target,isVisible:async()=>false})})};await assert.rejects(captureCaptchaImage(hidden),/VISIBLE_CAPTCHA_REGION_UNAVAILABLE/);
});
test('actual PostgreSQL: CAPTCHA handoff remains application-local, durable and honest about Telegram delivery',{skip:!process.env.DATABASE_URL,timeout:30000},async t=>{
 const repository=new Repository(),admin=repository.pool,schema='captcha_handoff_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);repository.pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`,max:5});
 t.after(async()=>{await repository.pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});await repository.migrate();
 async function seed(status='MANUAL_TAKEOVER'){
  const applicationId=randomUUID(),job=randomUUID(),sessionId=randomUUID(),fingerprint='schema-'+randomUUID();
  await repository.pool.query("INSERT INTO jobs(job_id,canonical_url,application_url,company,title,description_text,content_hash)VALUES($1,$2,$2,'ISOLATED CAPTCHA TEST','No live employer','Fixture','isolated')",[job,`https://fixture.invalid/${job}`]);
  await repository.pool.query('INSERT INTO applications(application_id,candidate_profile_id,job_id,status,last_state)VALUES($1,$2,$3,$4,$5)',[applicationId,'captcha-regression',job,status,{browser_session_id:sessionId,reason:status==='MANUAL_TAKEOVER'?'INTERACTIVE_CAPTCHA':null}]);
  const snapshot={browser_session_id:sessionId,url:`https://fixture.invalid/${job}/application?token=private-fixture-token`,fingerprint,captcha:true};
  return {applicationId,sessionId,snapshot};
 }
 const cropped={png_base64:png.toString('base64'),scope:'CAPTCHA_ELEMENT_CROP',redacted:true,persisted:false};
 const browserFor=(input,image=cropped)=>({call:async endpoint=>{assert.ok(endpoint.endsWith('/snapshot')||endpoint.endsWith('/captcha-image'));return endpoint.endsWith('/snapshot')?input.snapshot:image;}});
 await t.test('missing configuration persists once without waiting, captures nothing and leaves another application running',async()=>{
  const first=await seed(),other=await seed('FILLING'),row=await enqueueCaptchaHandoff({repository,...first});
  const again=await enqueueCaptchaHandoff({repository,...first});assert.equal(row.handoff_id,again.handoff_id);assert.equal((await repository.pool.query('SELECT count(*)::int AS n FROM application_questions WHERE application_id=$1',[first.applicationId])).rows[0].n,1);
  assert.equal(row.official_url.includes('private-fixture-token'),false);
  const waiting=await deliverCaptchaHandoff({repository,handoffId:row.handoff_id,browser:{call:()=>{throw new Error('Capture must wait for configuration');}},telegram:{fetch:()=>{throw new Error('No configured recipient');}}});assert.equal(waiting.delivery_status,'WAITING_CONFIGURATION');
  const before=(await repository.pool.query('SELECT count(*)::int AS n FROM events WHERE entity_id=$1',[first.applicationId])).rows[0].n;
  await drainCaptchaHandoffs({repository,browser:{},telegram:{},limit:1});assert.equal((await repository.pool.query('SELECT count(*)::int AS n FROM events WHERE entity_id=$1',[first.applicationId])).rows[0].n,before);
  assert.equal((await repository.pool.query('SELECT paused FROM runtime_control')).rows[0].paused,false);assert.equal((await repository.pool.query('SELECT status FROM applications WHERE application_id=$1',[other.applicationId])).rows[0].status,'FILLING');
  const q=(await repository.pool.query('SELECT * FROM application_questions WHERE question_id=$1',[row.question_id])).rows[0];await assert.rejects(answerApplicationQuestion(repository,{questionId:q.question_id,correlationId:q.telegram_request_id,answer:'a guessed code',source:'USER_CHAT',profileId:'captcha-regression'}),/APPLICATION_NOT_WAITING_FOR_ANSWER/);
 });
 await t.test('concurrent workers relay only cropped image once and record confirmed delivery',async()=>{
  const input=await seed(),row=await enqueueCaptchaHandoff({repository,...input});let sends=0;
  const telegram={token:'isolated-no-network-token',chatId:'12345',fetch:async(url,request)=>{sends++;assert.ok(url.endsWith('/sendPhoto'));assert.ok(request.body instanceof FormData);assert.equal(request.body.get('chat_id'),'12345');assert.equal(request.body.get('photo').name,'captcha-region.png');assert.equal(request.body.get('caption').includes('private-fixture-token'),false);return {ok:true,json:async()=>({ok:true,result:{message_id:721}})};}};
  await Promise.all([deliverCaptchaHandoff({repository,handoffId:row.handoff_id,browser:browserFor(input),telegram}),deliverCaptchaHandoff({repository,handoffId:row.handoff_id,browser:browserFor(input),telegram})]);assert.equal(sends,1);
  const stored=(await repository.pool.query('SELECT delivery_status,telegram_message_id FROM captcha_handoffs WHERE handoff_id=$1',[row.handoff_id])).rows[0];assert.equal(stored.delivery_status,'SENT');assert.equal(Number(stored.telegram_message_id),721);assert.equal((await repository.pool.query('SELECT status FROM applications WHERE application_id=$1',[input.applicationId])).rows[0].status,'MANUAL_TAKEOVER');
 });
 await t.test('full-page image is refused; link fallback records its actual scope',async()=>{
  const input=await seed(),row=await enqueueCaptchaHandoff({repository,...input});const telegram={token:'isolated',chatId:'12345',fetch:async(url,request)=>{assert.ok(url.endsWith('/sendMessage'));assert.ok(JSON.parse(request.body).text.includes('/manual-captcha/'));return {ok:true,json:async()=>({ok:true,result:{message_id:722}})};}};
  const result=await deliverCaptchaHandoff({repository,handoffId:row.handoff_id,browser:browserFor(input,{...cropped,scope:'FULL_PAGE'}),telegram});assert.equal(result.delivery_status,'SENT_LINK_ONLY');
 });
 await t.test('ambiguous outbound send is never blindly retried',async()=>{
  const input=await seed(),row=await enqueueCaptchaHandoff({repository,...input});let sends=0;const telegram={token:'isolated',chatId:'12345',fetch:async()=>{sends++;throw new Error('Ambiguous transport failure including a secret');}};
  const result=await deliverCaptchaHandoff({repository,handoffId:row.handoff_id,browser:browserFor(input),telegram});assert.equal(result.delivery_status,'DELIVERY_UNKNOWN');await deliverCaptchaHandoff({repository,handoffId:row.handoff_id,browser:browserFor(input),telegram});assert.equal(sends,1);
  const event=(await repository.pool.query("SELECT payload_json FROM events WHERE entity_id=$1 AND event_type='CAPTCHA_HANDOFF_DELIVERY'",[input.applicationId])).rows[0];assert.equal(JSON.stringify(event).includes('secret'),false);
 });
 await t.test('changed CAPTCHA observation cannot relay an obsolete image or claim delivery',async()=>{
  const input=await seed(),row=await enqueueCaptchaHandoff({repository,...input});let sends=0;const browser={call:async()=>({...input.snapshot,fingerprint:'changed'})},telegram={token:'isolated',chatId:'12345',fetch:async()=>{sends++;}};
  const result=await deliverCaptchaHandoff({repository,handoffId:row.handoff_id,browser,telegram});assert.equal(result.delivery_status,'FAILED');assert.equal(sends,0);
 });
 await t.test('superseded or unavailable browser handoff cannot send an old manual link',async()=>{
  const input=await seed(),old=await enqueueCaptchaHandoff({repository,...input});const updated={...input,snapshot:{...input.snapshot,fingerprint:'new-form-generation'}};const fresh=await enqueueCaptchaHandoff({repository,...updated});let sends=0;const telegram={token:'isolated',chatId:'12345',fetch:async()=>{sends++;}};
  assert.equal((await deliverCaptchaHandoff({repository,handoffId:old.handoff_id,browser:browserFor(input),telegram})).delivery_status,'FAILED');assert.equal(sends,0);
  assert.equal((await deliverCaptchaHandoff({repository,handoffId:fresh.handoff_id,browser:{call:async()=>{throw new Error('SESSION_NOT_FOUND');}},telegram})).delivery_status,'FAILED');assert.equal(sends,0);
 });
});
