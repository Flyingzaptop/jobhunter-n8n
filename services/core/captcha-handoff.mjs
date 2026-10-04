import {randomUUID} from 'node:crypto';
import {observerUrl} from '../browser-service/ats-adapters.mjs';
import {captchaQueue} from './captcha-telegram.mjs';
import {issueCaptchaAccess} from './captcha-access.mjs';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const manualQuestion='CAPTCHA requires your manual browser interaction. Open the employer page or inspect this application in the dashboard. This application waits; other jobs continue. Do not send passwords, tokens, or CAPTCHA codes as a factual answer.';
async function event(client,id,kind,payload){await client.query('INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json)VALUES($1,$2,$3,$4,$5)',[randomUUID(),'application',id,kind,payload]);}
export async function enqueueCaptchaHandoff({repository,applicationId,sessionId,snapshot,chatId=null,dashboardOrigin=process.env.DASHBOARD_PUBLIC_URL||`http://127.0.0.1:${process.env.DASHBOARD_PORT||3020}`}){
 if(!uuid(applicationId)||!uuid(sessionId)||snapshot?.browser_session_id!==sessionId||snapshot.captcha!==true||typeof snapshot.fingerprint!=='string'||!snapshot.fingerprint)throw new Error('OBSERVED_CAPTCHA_SESSION_REQUIRED');
 const official=new URL(observerUrl(snapshot.url)),dashboard=new URL(dashboardOrigin);
 if(!['http:','https:'].includes(official.protocol)||!['http:','https:'].includes(dashboard.protocol)||dashboard.username||dashboard.password)throw new Error('MANUAL_HANDOFF_URL_REJECTED');
 const dashboardUrl=new URL(`/manual-captcha/${applicationId}`,dashboard.origin).href,client=await repository.pool.connect();
 try{
  await client.query('BEGIN');
  const app=(await client.query('SELECT * FROM applications WHERE application_id=$1 FOR UPDATE',[applicationId])).rows[0];
  if(!app||!['MANUAL_TAKEOVER','CAPTCHA_WAIT'].includes(app.status)||(app.status==='MANUAL_TAKEOVER'&&app.last_state?.reason!=='INTERACTIVE_CAPTCHA')||app.confirmation_id||app.submitted_at||app.last_state?.browser_session_id!==sessionId)throw new Error('APPLICATION_NOT_IN_MANUAL_CAPTCHA_STATE');
  const previous=(await client.query('SELECT * FROM captcha_handoffs WHERE application_id=$1 AND browser_session_id=$2 AND form_fingerprint=$3',[applicationId,sessionId,snapshot.fingerprint])).rows[0];
  if(previous){await client.query('COMMIT');return previous;}
  const handoffId=randomUUID(),questionId=randomUUID(),requestId=randomUUID();
  await client.query('INSERT INTO application_questions(question_id,application_id,normalized_question,raw_question,telegram_request_id,telegram_chat_id)VALUES($1,$2,$3,$3,$4,$5)',[questionId,applicationId,manualQuestion,requestId,chatId?String(chatId):null]);
  const row=(await client.query('INSERT INTO captcha_handoffs(handoff_id,application_id,question_id,browser_session_id,form_fingerprint,official_url,dashboard_url)VALUES($1,$2,$3,$4,$5,$6,$7)RETURNING *',[handoffId,applicationId,questionId,sessionId,snapshot.fingerprint,official.href,dashboardUrl])).rows[0];
  await client.query('UPDATE applications SET last_state=last_state||$2::jsonb,updated_at=now() WHERE application_id=$1',[applicationId,{pending_question:{type:'MANUAL_CAPTCHA',field_type:'manual',question:manualQuestion,request_id:requestId,fingerprint:snapshot.fingerprint,browser_session_id:sessionId},captcha_handoff:{handoff_id:handoffId,browser_session_id:sessionId,official_url:official.href,dashboard_url:dashboardUrl,human_interaction_required:true,delivery_status:'PENDING',blocks_other_applications:false}}]);
  await event(client,applicationId,'CAPTCHA_HANDOFF_PERSISTED',{handoff_id:handoffId,question_id:questionId,browser_session_id:sessionId,blocks_other_applications:false});
  await client.query('COMMIT');return row;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
async function finish(repository,row,status,errorCode=null,messageId=null){
 const expected=status==='WAITING_CONFIGURATION'?['PENDING','WAITING_CONFIGURATION']:['DELIVERING'];
 const changed=await repository.pool.query('UPDATE captcha_handoffs SET delivery_status=$2,delivery_error_code=$3,telegram_message_id=$4,delivered_at=CASE WHEN $2 IN (\'SENT\',\'SENT_LINK_ONLY\') THEN now() ELSE delivered_at END WHERE handoff_id=$1 AND delivery_status=ANY($5::text[]) RETURNING handoff_id',[row.handoff_id,status,errorCode,messageId,expected]);
 if(!changed.rowCount)return {handoff_id:row.handoff_id,claimed:false};
 await repository.pool.query("UPDATE applications SET last_state=jsonb_set(last_state,'{captcha_handoff,delivery_status}',to_jsonb($2::text)),updated_at=now() WHERE application_id=$1 AND last_state->'captcha_handoff'->>'handoff_id'=$3",[row.application_id,status,row.handoff_id]);
 if(messageId)await repository.pool.query('UPDATE application_questions SET telegram_message_id=$2 WHERE question_id=$1',[row.question_id,messageId]);
 await repository.event('application',row.application_id,'CAPTCHA_HANDOFF_DELIVERY',{handoff_id:row.handoff_id,status,...(errorCode?{error_code:errorCode}:{})});
 return {handoff_id:row.handoff_id,application_id:row.application_id,delivery_status:status,blocks_other_applications:false};
}
export async function deliverCaptchaHandoff({repository,handoffId,browser,telegram}){
 if(!uuid(handoffId))throw new Error('INVALID_CAPTCHA_HANDOFF_ID');
 const row=(await repository.pool.query('SELECT * FROM captcha_handoffs WHERE handoff_id=$1',[handoffId])).rows[0];
 if(!row)throw new Error('CAPTCHA_HANDOFF_NOT_FOUND');
 if(row.resolved_at)return {handoff_id:handoffId,claimed:false,resolved:true};
 if(!['PENDING','WAITING_CONFIGURATION'].includes(row.delivery_status))return {handoff_id:handoffId,delivery_status:row.delivery_status,claimed:false};
 if(!telegram?.token||!telegram?.chatId)return row.delivery_status==='WAITING_CONFIGURATION'?{handoff_id:handoffId,delivery_status:row.delivery_status,claimed:false}:finish(repository,row,'WAITING_CONFIGURATION','TELEGRAM_NOT_CONFIGURED');
 const claimed=(await repository.pool.query("UPDATE captcha_handoffs SET delivery_status='DELIVERING',delivery_started_at=now(),delivery_attempts=delivery_attempts+1 WHERE handoff_id=$1 AND delivery_status IN ('PENDING','WAITING_CONFIGURATION') RETURNING *",[handoffId])).rows[0];
 if(!claimed)return {handoff_id:handoffId,claimed:false};
 const current=(await repository.pool.query('SELECT status,last_state,candidate_profile_id FROM applications WHERE application_id=$1',[row.application_id])).rows[0];
 if(!current||!['MANUAL_TAKEOVER','CAPTCHA_WAIT'].includes(current.status)||current.last_state?.captcha_handoff?.handoff_id!==row.handoff_id||current.last_state?.browser_session_id!==row.browser_session_id)return finish(repository,row,'FAILED','CAPTCHA_HANDOFF_SUPERSEDED');
 let photo;
 let fresh;try{fresh=await browser.call(`/sessions/${row.browser_session_id}/snapshot`);}catch{return finish(repository,row,'FAILED','CAPTCHA_SESSION_UNAVAILABLE');}
 if(!fresh.captcha||fresh.fingerprint!==row.form_fingerprint)return finish(repository,row,'FAILED','CAPTCHA_HANDOFF_OBSERVATION_STALE');
 try{const image=await browser.call(`/sessions/${row.browser_session_id}/captcha-image`,{});if(image.scope==='CAPTCHA_ELEMENT_CROP'&&image.redacted===true&&image.persisted===false&&typeof image.png_base64==='string'){const bytes=Buffer.from(image.png_base64,'base64');if(bytes.length<=2*1024*1024&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))photo=bytes;}}catch{/* A link to the same active session remains useful when capture is unavailable. */}
 const queue=await captchaQueue(repository,{profileId:current.candidate_profile_id}),item=queue.requests.find(r=>r.handoff_id===row.handoff_id);
 let access;try{access=await issueCaptchaAccess({repository,handoffId:row.handoff_id,profileId:current.candidate_profile_id});}catch{return finish(repository,row,'FAILED','CAPTCHA_ACCESS_SCOPE_STALE');}
 const text=`Manual CAPTCHA ${item?.queue_number??'?'} / ${queue.pending_count}\nRequest [${item?.request_short_id??row.handoff_id.slice(0,8)}] · ${(item?.company??'').slice(0,80)}\n${(item?.title??'').slice(0,160)}\nPending requests: ${queue.pending_count}\nPrivate CAPTCHA-only link (one use, 30 minutes): ${access.url}\nSolve manually in this session, then reply to THIS message with готово. Other jobs continue; no application was submitted.`;
 let response,result;
 try{
  if(photo){const form=new FormData();form.set('chat_id',telegram.chatId);form.set('caption',text.slice(0,1024));form.set('photo',new Blob([photo],{type:'image/png'}),'captcha-region.png');response=await telegram.fetch(`https://api.telegram.org/bot${telegram.token}/sendPhoto`,{method:'POST',body:form,signal:AbortSignal.timeout(10000)});}
  else response=await telegram.fetch(`https://api.telegram.org/bot${telegram.token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:telegram.chatId,text:text.slice(0,4096)}),signal:AbortSignal.timeout(10000)});
  result=await response.json();
 }catch{return finish(repository,row,'DELIVERY_UNKNOWN','DELIVERY_FAILED_OR_AMBIGUOUS');}
 if(!response.ok||result.ok!==true)return finish(repository,row,'FAILED','TELEGRAM_REJECTED_DELIVERY');
 const messageId=result.result?.message_id;
 if(!Number.isSafeInteger(messageId)||messageId<1)return finish(repository,row,'DELIVERY_UNKNOWN','TELEGRAM_CONFIRMATION_MISSING');
 await repository.pool.query('UPDATE application_questions SET telegram_chat_id=$2 WHERE question_id=$1',[row.question_id,telegram.chatId]);
 return finish(repository,row,photo?'SENT':'SENT_LINK_ONLY',null,messageId);
}
export async function drainCaptchaHandoffs({repository,browser,telegram,limit=5}){
 if(!Number.isInteger(limit)||limit<1||limit>20)throw new Error('INVALID_CAPTCHA_DELIVERY_LIMIT');
 const rows=(await repository.pool.query("SELECT handoff_id FROM captcha_handoffs WHERE resolved_at IS NULL AND delivery_status IN ('PENDING','WAITING_CONFIGURATION') ORDER BY created_at LIMIT $1",[limit])).rows;
 const results=[];for(const row of rows)results.push(await deliverCaptchaHandoff({repository,handoffId:row.handoff_id,browser,telegram}));
 return {results,global_pause_changed:false};
}
