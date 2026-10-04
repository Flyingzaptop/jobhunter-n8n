import {randomUUID,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {resumeVerifiedHumanCaptcha} from './manual-captcha-resume.mjs';
import {issueCaptchaAccess} from './captcha-access.mjs';
export async function captchaQueue(repository,{profileId}={}){
 const requests=(await repository.pool.query(`SELECT h.handoff_id,h.application_id,h.browser_session_id,h.delivery_status,h.dashboard_url,q.telegram_request_id,j.company,j.title
  FROM captcha_handoffs h JOIN applications a USING(application_id) JOIN application_questions q USING(question_id) JOIN jobs j ON j.job_id=a.job_id
  WHERE h.resolved_at IS NULL AND a.status IN ('MANUAL_TAKEOVER','CAPTCHA_WAIT') AND a.last_state->'captcha_handoff'->>'handoff_id'=h.handoff_id::text
  AND a.last_state->>'browser_session_id'=h.browser_session_id::text AND ($1::text IS NULL OR a.candidate_profile_id=$1)
  ORDER BY h.created_at,h.handoff_id`,[profileId??null])).rows;
 return {scope:'REAL_APPLICATION',pending_count:requests.length,requests:requests.map((r,i)=>{let size=8;while(requests.some(other=>other!==r&&other.telegram_request_id.startsWith(r.telegram_request_id.slice(0,size))))size+=4;return {...r,queue_number:i+1,request_short_id:r.telegram_request_id.slice(0,size)};})};
}
export async function acceptCaptchaTelegramReply(repository,{messageId,chatId,text}){
 const rows=(await repository.pool.query(`SELECT h.*,q.telegram_request_id,a.status AS application_status,a.last_state
  FROM captcha_handoffs h JOIN application_questions q USING(question_id) JOIN applications a ON a.application_id=h.application_id
  WHERE h.telegram_message_id=$1 AND q.telegram_message_id=$1 AND q.telegram_chat_id=$2`,[messageId,chatId])).rows;
 if(!rows.length)return null;
 if(rows.length!==1)throw Object.assign(new Error('CAPTCHA_REPLY_SCOPE_AMBIGUOUS'),{code:'CAPTCHA_REPLY_SCOPE_AMBIGUOUS'});
 const r=rows[0];
 if(r.resolved_at||!['MANUAL_TAKEOVER','CAPTCHA_WAIT'].includes(r.application_status)||r.last_state?.captcha_handoff?.handoff_id!==r.handoff_id||r.last_state?.browser_session_id!==r.browser_session_id)throw Object.assign(new Error('CAPTCHA_REPLY_STALE'),{code:'CAPTCHA_REPLY_STALE'});
 const verify_requested=/^(?:готово|решено|готов|done|solved|ready|gotowe)$/i.test(text.trim());
 await repository.event('application',r.application_id,'CAPTCHA_HANDOFF_REPLY_RECEIVED',{source:'USER_TELEGRAM',handoff_id:r.handoff_id,question_id:r.question_id,request_id:r.telegram_request_id,verify_requested});
 return {application_id:r.application_id,captcha_handoff_id:r.handoff_id,verify_requested};
}
export async function dispatchCaptchaTelegramReply({repository,browser,telegram,accepted,profileId}){
 const queue=await captchaQueue(repository,{profileId}),item=queue.requests.find(r=>r.handoff_id===accepted.captcha_handoff_id&&r.application_id===accepted.application_id);
 if(!item){await telegram.send('This CAPTCHA request is no longer active. Use /captcha_queue to see current requests.');return {status:'STALE_CAPTCHA_HANDOFF'};}
 let verified=false;
 if(accepted.verify_requested){
  try{await resumeVerifiedHumanCaptcha({repository,browser,applicationId:item.application_id,profileId,source:'USER_TELEGRAM',expectedHandoffId:item.handoff_id});verified=true;}
  catch(error){if(!/^(?:FRESH_HUMAN_CAPTCHA_COMPLETION_REQUIRED|CURRENT_UNRESOLVED_CAPTCHA_HANDOFF_REQUIRED|MANUAL_CAPTCHA_APPLICATION_NOT_ELIGIBLE)$/.test(error.message))throw error;}
 }
 const after=await captchaQueue(repository,{profileId});
 await telegram.send(`${verified?'CAPTCHA verified; this application resumes in its existing session.':'Your reply was received. CAPTCHA completion has not been verified; this application still waits.'}\nRequest ${item.request_short_id} · ${item.company} · ${item.title}\nPending CAPTCHA requests: ${after.pending_count}\n${item.dashboard_url}\nOther jobs continue. No application was submitted.`.slice(0,4096));
 return {application_id:item.application_id,status:verified?'FILLING':'WAITING_FOR_HUMAN_CAPTCHA',verified,pending_count:after.pending_count};
}
export async function sendCaptchaQueue(repository,telegram,{profileId}={}){
 const queue=await captchaQueue(repository,{profileId});
 const transport=(await repository.pool.query("SELECT count(*)::int AS n FROM captcha_transport_tests WHERE telegram_chat_id=$1 AND status='SENT' AND expires_at>now()",[telegram.chatId])).rows[0]?.n??0;
 const links=[];for(const r of queue.requests.slice(0,8)){const access=await issueCaptchaAccess({repository,handoffId:r.handoff_id,profileId});links.push(`${r.queue_number}. [${r.request_short_id}] ${r.company.slice(0,60)} · ${r.title.slice(0,100)}\n${access.url}`);}
 const text=`Pending real CAPTCHA requests: ${queue.pending_count}\nTransport-test photos awaiting codes: ${transport}\n${queue.pending_count>8?'Showing the first 8 active requests; other request links remain in their own messages.\n':''}${links.join('\n\n')}\nPrivate CAPTCHA links are one-use, valid for 30 minutes, and require no dashboard password. Solve each challenge yourself and reply directly to its photo with готово. Replies request verification; transport-test codes do not verify real applications.`;
 await telegram.send(text.slice(0,4096));return {pending_count:queue.pending_count};
}
const codeDigest=(salt,code)=>createHash('sha256').update(salt+'\0'+code.trim().toUpperCase()).digest('hex');
export async function sendCaptchaTransportTest({repository,telegram,png,code,ttlMs=10*60*1000}){
 if(!telegram.token||!telegram.chatId)throw new Error('TELEGRAM_NOT_CONFIGURED');
 if(typeof code!=='string'||!/^[A-Z2-9]{6}$/.test(code)||!Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>30*60*1000)throw new Error('INVALID_TRANSPORT_TEST_CODE');
 const requestId=randomUUID(),salt=randomBytes(16).toString('hex');await repository.pool.query("INSERT INTO captcha_transport_tests(request_id,telegram_chat_id,status,code_salt,code_hash,expires_at)VALUES($1,$2,'PENDING',$3,$4,$5)",[requestId,telegram.chatId,salt,codeDigest(salt,code),new Date(Date.now()+ttlMs)]);
 const form=new FormData();form.set('chat_id',telegram.chatId);form.set('caption',`[TRANSPORT_TEST] Telegram photo/code reply correlation only\nRequest ${requestId.slice(0,8)}\nReply directly to this photo with its displayed code (valid for ${Math.round(ttlMs/60000)} minutes).\nThis is not a real employer CAPTCHA and does not verify or submit any application.`);form.set('photo',new Blob([png],{type:'image/png'}),'transport-test.png');
 let response,result;try{response=await telegram.fetch(`https://api.telegram.org/bot${telegram.token}/sendPhoto`,{method:'POST',body:form,signal:AbortSignal.timeout(10000)});result=await response.json();}catch{await repository.pool.query("UPDATE captcha_transport_tests SET status='DELIVERY_UNKNOWN',error_code='AMBIGUOUS_SEND' WHERE request_id=$1",[requestId]);return {scope:'TRANSPORT_TEST',request_id:requestId,status:'DELIVERY_UNKNOWN'};}
 const message=result.result?.message_id;if(!response.ok||result.ok!==true||!Number.isSafeInteger(message)){await repository.pool.query("UPDATE captcha_transport_tests SET status='FAILED',error_code='SEND_NOT_CONFIRMED' WHERE request_id=$1",[requestId]);return {scope:'TRANSPORT_TEST',request_id:requestId,status:'FAILED'};}
 await repository.pool.query("UPDATE captcha_transport_tests SET status='SENT',telegram_message_id=$2 WHERE request_id=$1",[requestId,message]);return {scope:'TRANSPORT_TEST',request_id:requestId,status:'SENT'};
}
export async function acceptCaptchaTransportReply(repository,{messageId,chatId,text}){
 const row=(await repository.pool.query('SELECT * FROM captcha_transport_tests WHERE telegram_message_id=$1 AND telegram_chat_id=$2 FOR UPDATE',[messageId,chatId])).rows[0];
 if(!row)return null;
 if(row.status!=='SENT'||!row.code_hash||!row.code_salt||!row.expires_at||new Date(row.expires_at)<=new Date())throw Object.assign(new Error('CAPTCHA_TRANSPORT_STALE'),{code:'CAPTCHA_TRANSPORT_STALE'});
 const actual=Buffer.from(codeDigest(row.code_salt,text),'hex'),expected=Buffer.from(row.code_hash,'hex'),valid=actual.length===expected.length&&timingSafeEqual(actual,expected);
 await repository.pool.query("UPDATE captcha_transport_tests SET attempt_count=attempt_count+1,status=CASE WHEN $2 THEN 'REPLIED' ELSE status END,reply_received_at=CASE WHEN $2 THEN now() ELSE reply_received_at END WHERE request_id=$1",[row.request_id,valid]);
 await repository.event('system',row.request_id,'CAPTCHA_TRANSPORT_REPLY_RECEIVED',{scope:'TRANSPORT_TEST',source:'USER_TELEGRAM',code_valid:valid});
 return {command:'/captcha_transport_reply',transport_request_id:row.request_id,transport_valid:valid};
}
