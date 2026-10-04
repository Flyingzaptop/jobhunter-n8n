import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Telegram} from '../services/core/telegram.mjs';
const telegram=new Telegram();
try{
 const text='JobHunter подключён. Кириллица исправлена. Реальные вакансии собираются; CAPTCHA решаешь ты. Отправка заявки требует отдельного подтверждения.';
 const message=process.argv.includes('--edit-initial')
  ? await telegram.call('editMessageText',{message_id:221,text}) : await telegram.send(text);
 if(message.text!==text)throw new Error('UTF8_ROUNDTRIP_FAILED');
 const proof={pass:true,message_id:message.message_id,verified_at:new Date().toISOString(),utf8_roundtrip:true,
  config_fingerprint:createHash('sha256').update(JSON.stringify({token:telegram.token,chat_id:telegram.chatId})).digest('hex')};
 if(process.argv.includes('--pdf')){
  const manifest=JSON.parse(await readFile('data/cv-v2/2026-10/Linear/55f8b831-91dc-5b6b-a173-7c24d9e9f4ba/1de99092-4632-4615-9d13-7bf679993b0b/manifest.json','utf8'));
  const bytes=await readFile(manifest.pdf_path);
  if(!manifest.qa?.pass||createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw new Error('VERIFIED_PDF_REQUIRED');
  const form=new FormData();form.set('chat_id',telegram.chatId);form.set('caption','Тест доставки проверенного CV/PDF. Работодателю заявка не отправлялась.');
  form.set('document',new Blob([bytes],{type:'application/pdf'}),'JobHunter-CV-test.pdf');
  const response=await telegram.fetch(`https://api.telegram.org/bot${telegram.token}/sendDocument`,{method:'POST',body:form,signal:AbortSignal.timeout(30000)});
  const result=await response.json();
  if(!response.ok||!result.ok||!result.result?.document||!result.result.message_id)throw new Error('PDF_DELIVERY_FAILED');
  proof.pdf_delivery={pass:true,message_id:result.result.message_id,sha256:manifest.sha256};
 }
 await mkdir('data/telegram',{recursive:true});
 await writeFile('data/telegram/delivery-proof.json',JSON.stringify(proof,null,2));
 console.log(JSON.stringify({message_delivered:true,utf8_roundtrip:true,pdf_delivered:proof.pdf_delivery?.pass??false}));
}catch(error){console.log(JSON.stringify({status:'FAILED',code:/^[A-Z_]+$/.test(error.message)?error.message:'TELEGRAM_DELIVERY_CHECK_FAILED'}));process.exitCode=1;}
