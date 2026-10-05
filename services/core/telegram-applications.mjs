import {randomUUID} from 'node:crypto';
import {prepareApplicationReview,approveApplicationReview,activeProfileDigest} from '../dashboard/review-gates.mjs';
import {assertControlledApplicationReady} from './controlled-submit-gate.mjs';
import {executeConfirmedSubmit} from './confirmed-submit.mjs';
import {hitlError} from './hitl.mjs';
import {readFile} from 'node:fs/promises';
const clean=(value,max=500)=>String(value??'').replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
export const escapeTelegram=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

export function vacancySummary(job,analysis={}){
 const e=escapeTelegram;
 const matches=(analysis.requirements??[]).filter(r=>r.match==='YES'||r.match==='PARTIAL').slice(0,2).map(r=>`• ${r.match==='YES'?'Совпадает':'Частично'}: ${e(clean(r.requirement??r.source_quote,80))}\n  ${e(clean(r.reason,100))}`);
 const gaps=(analysis.requirements??[]).filter(r=>r.importance==='MANDATORY'&&['NO','UNKNOWN'].includes(r.match)).slice(0,2).map(r=>`• ${r.match==='UNKNOWN'?'Не подтверждено':'Не выполнено'}: ${e(clean(r.requirement??r.source_quote,100))}`);
 return `<b>${e(clean(job.title,120))}</b>\n${e(clean(job.company,80))} · ${e(clean(job.location,80))}\n\n<b>Работа</b>\n${e(clean(job.description_text,250))}\n\n<b>Соответствие — ${e(analysis.overall_fit??'—')}/100</b>\n${matches.join('\n')||'Оценка ещё не завершена'}\n\n<b>Что проверить</b>\n${gaps.join('\n')||'Обязательные пробелы не отмечены'}\nРабота из Польши: ${analysis.employment_eligibility?.work_from_poland_allowed===true?'подтверждена':analysis.employment_eligibility?.work_from_poland_allowed===false?'не подходит':'не подтверждена'}\n\n<a href="${e(job.canonical_url)}">Открыть вакансию</a>`;
}
export async function searchCounts(repository,profile){
 const jobs=(await repository.pool.query("SELECT count(*)::int n FROM jobs WHERE canonical_url LIKE 'https://%' AND COALESCE(metadata->>'test_fixture','false')<>'true'")).rows[0].n;
 const stages=(await repository.pool.query('SELECT status,count(*)::int n FROM applications WHERE candidate_profile_id=$1 GROUP BY status',[profile.profile_id])).rows;
 const cvs=(await repository.pool.query("SELECT count(DISTINCT c.job_id)::int n FROM cv_versions c JOIN jobs j USING(job_id) WHERE c.profile_version=$1 AND c.template_version='cv-factory-v2.3-exact-vacancy' AND c.qa_json->>'pass'='true'",[activeProfileDigest(profile)])).rows[0].n;
 const get=status=>stages.find(r=>r.status===status)?.n??0;
 return {found:jobs,cv:cvs,ready:get('READY_TO_SUBMIT'),submitted:get('SUBMITTED'),waiting:get('NEEDS_USER')+get('CAPTCHA_WAIT'),unknown:get('SUBMISSION_UNKNOWN')};
}
export function countsText(c){return `СВОДКА JOBHUNTER\n\nПОИСК\nСобрано объявлений: ${c.found}\nИндивидуальных CV: ${c.cv}\n\nЗАЯВКИ\nГотовы к подтверждению: ${c.ready}\nНужно твоё действие: ${c.waiting}\nПодтверждённо отправлено: ${c.submitted}\n${c.unknown?'Неопределённый результат: '+c.unknown+'\n':''}\nСобранное объявление ≠ отправленная заявка.`;}
export function countsHtml(c){return `<b>СВОДКА JOBHUNTER</b>\n\n<b>Поиск</b>\nСобрано объявлений: <b>${c.found}</b>\nИндивидуальных CV: <b>${c.cv}</b>\n\n<b>Заявки</b>\nГотовы к подтверждению: <b>${c.ready}</b>\nНужно твоё действие: <b>${c.waiting}</b>\nПодтверждённо отправлено: <b>${c.submitted}</b>\n${c.unknown?'⚠ Неопределённый результат: <b>'+c.unknown+'</b>\n':''}\n<i>Объявления не считаются отправленными заявками.</i>`;}

export async function sendReadyApplications({repository,profile,browser,telegram}){
 const apps=(await repository.pool.query("SELECT * FROM applications WHERE candidate_profile_id=$1 AND status='READY_TO_SUBMIT' ORDER BY updated_at LIMIT 20",[profile.profile_id])).rows;
 for(const app of apps){
  try{
  const already=(await repository.pool.query("SELECT 1 FROM events WHERE entity_id=$1 AND event_type IN ('TELEGRAM_REVIEW_DELIVERY_STARTED','TELEGRAM_APPLICATION_REVIEW_SENT') LIMIT 1",[app.application_id])).rowCount;
  if(already)continue;
  await assertControlledApplicationReady({repository,applicationId:app.application_id,profile});
  const prepared=await prepareApplicationReview(repository,app.application_id,profile,browser,{ttlMs:86400000});
  const job=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[app.job_id])).rows[0];
  const analysis=(await repository.pool.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[app.job_id])).rows[0]?.analysis_json;
  await repository.event('application',app.application_id,'TELEGRAM_REVIEW_DELIVERY_STARTED',{approval_id:prepared.gate.approval_id});
  const answers=prepared.summary.answers.map(a=>`${a.question}: ${a.answer}`).join('\n');
  const cv=(await repository.pool.query('SELECT pdf_path FROM cv_versions WHERE cv_id=$1',[app.cv_id])).rows[0];
  const form=new FormData();form.set('chat_id',telegram.chatId);form.set('caption',`CV для проверки · ${app.application_id.slice(0,8)} · пакет ${prepared.gate.binding_digest.slice(0,12)}`);form.set('document',new Blob([await readFile(cv.pdf_path)],{type:'application/pdf'}),'cv.pdf');
  const response=await telegram.fetch(`https://api.telegram.org/bot${telegram.token}/sendDocument`,{method:'POST',body:form,signal:AbortSignal.timeout(30000)});const document=await response.json();
  if(!response.ok||!document.ok||String(document.result?.chat?.id)!==telegram.chatId)throw hitlError('TELEGRAM_REVIEW_PDF_NOT_CONFIRMED');
  const details=new FormData();details.set('chat_id',telegram.chatId);details.set('caption','Полные ответы и согласия для этой заявки');details.set('document',new Blob([answers],{type:'text/plain;charset=utf-8'}),'answers.txt');
  const detailResponse=await telegram.fetch(`https://api.telegram.org/bot${telegram.token}/sendDocument`,{method:'POST',body:details,signal:AbortSignal.timeout(30000)});const detailResult=await detailResponse.json();
  if(!detailResponse.ok||!detailResult.ok||String(detailResult.result?.chat?.id)!==telegram.chatId)throw hitlError('TELEGRAM_REVIEW_ANSWERS_NOT_CONFIRMED');
  const sent=await telegram.sendHtml(`<b>НУЖНО ПОДТВЕРЖДЕНИЕ</b>\n\n${vacancySummary(job,analysis)}\n\n<b>Что готово</b>\nФорма заполнена. CV и полные ответы прикреплены выше.\n\n<b>Твоё действие</b>\nОтветь на ЭТУ карточку: <b>ОТПРАВИТЬ</b>\nБез ответа заявка не отправится.\n\n<code>Заявка ${app.application_id.slice(0,8)}</code>`);
  await repository.event('application',app.application_id,'TELEGRAM_APPLICATION_REVIEW_SENT',{approval_id:prepared.gate.approval_id,binding_digest:prepared.gate.binding_digest,message_id:sent.message_id,chat_id:telegram.chatId});
  }catch(error){await repository.event('application',app.application_id,'TELEGRAM_REVIEW_WAIT',{reason:/^[A-Z_]+$/.test(error.code??error.message)?error.code??error.message:'REVIEW_DELIVERY_UNVERIFIED'});}
 }
}
export async function acceptTelegramSubmit(repository,message,chatId){
 if(String(message.from?.id)!==String(chatId)||message.from?.is_bot||!Number.isSafeInteger(message.reply_to_message?.message_id))throw hitlError('TELEGRAM_SUBMIT_REPLY_REQUIRED');
 const row=(await repository.pool.query(`SELECT e.entity_id AS application_id,e.payload_json,g.status,g.expires_at
  FROM events e JOIN application_review_gates g ON g.approval_id=(e.payload_json->>'approval_id')::uuid
  WHERE e.event_type='TELEGRAM_APPLICATION_REVIEW_SENT' AND e.payload_json->>'chat_id'=$1
  AND e.payload_json->>'message_id'=$2 ORDER BY e.created_at DESC LIMIT 1`,[String(chatId),String(message.reply_to_message.message_id)])).rows[0];
 if(!row||row.status!=='PREPARED'||Date.parse(row.expires_at)<=Date.now())throw hitlError('TELEGRAM_SUBMIT_REVIEW_STALE');
 return {command:'/confirm_submit',application_id:row.application_id,approval_id:row.payload_json.approval_id,binding_digest:row.payload_json.binding_digest,idempotency_key:randomUUID()};
}
export async function dispatchTelegramSubmit({repository,profile,browser,telegram,accepted}){
 try{
 await assertControlledApplicationReady({repository,applicationId:accepted.application_id,profile});
 await approveApplicationReview(repository,accepted.application_id,accepted.approval_id,accepted.binding_digest,profile,browser,{source:'USER_TELEGRAM'});
 const result=await executeConfirmedSubmit({repository,profile,browser,applicationId:accepted.application_id,approvalId:accepted.approval_id,bindingDigest:accepted.binding_digest,idempotencyKey:accepted.idempotency_key,confirmationSource:'USER_TELEGRAM'});
 await telegram.send(`Заявка ${accepted.application_id.slice(0,8)}: ${result.status}\n${result.confirmation_id?'Подтверждение: '+result.confirmation_id:'Без подтверждённого результата повторный Submit автоматически не выполняется.'}`);
 return result;
 }catch(error){await telegram.send(`Заявка ${accepted.application_id.slice(0,8)} не получила подтверждённого результата отправки: ${/^[A-Z_]+$/.test(error.code??'')?error.code:'проверка или запрос завершились ошибкой'}. Автоматически повторять Submit не буду.`);throw error;}
}
