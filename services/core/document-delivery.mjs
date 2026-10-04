import {createHash,randomUUID} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {verifyCurrentCvEvidence} from './cv-evidence.mjs';

const digest=value=>createHash('sha256').update(Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const activeProfile=profile=>{
 if(typeof profile?.profile_id!=='string'||!profile.profile_id.trim())throw new Error('DOCUMENT_PROFILE_REQUIRED');
 return{id:profile.profile_id,hash:digest(profile)};
};
const configState=telegram=>!telegram?.token||!telegram?.chatId||typeof telegram?.fetch!=='function'?'TELEGRAM_NOT_CONFIGURED':
 !/^[1-9][0-9]{0,18}$/.test(String(telegram.chatId))?'PRIVATE_TELEGRAM_CHAT_REQUIRED':
 !/^[0-9]+:[A-Za-z0-9_-]+$/.test(telegram.token)?'TELEGRAM_TOKEN_INVALID':null;
const safeCode=value=>/^[A-Z][A-Z0-9_]{0,100}$/.test(value??'')?value:'CV_EVIDENCE_REJECTED';
const reviewUrl=()=>{
 const base=new URL(process.env.DASHBOARD_PUBLIC_URL||`http://127.0.0.1:${process.env.DASHBOARD_PORT||3020}`);
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw new Error('DOCUMENT_REVIEW_URL_INVALID');
 return new URL('/#human-review',base.origin).href;
};
export function registeredCvCaption(job,url){
 const clean=value=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,180);
 return `Готовое CV\n${clean(job.company)} — ${clean(job.title)}\nВакансия ${String(job.job_id).slice(0,8)}\nПроверить: ${url}`.slice(0,1024);
}
async function currentEvidence(repo,cvId){
 const cv=(await repo.pool.query('SELECT * FROM cv_versions WHERE cv_id=$1',[cvId])).rows[0];
 if(!cv)return{cv:null,job:null,analysis:null};
 const job=(await repo.pool.query('SELECT * FROM jobs WHERE job_id=$1',[cv.job_id])).rows[0];
 const latest=(await repo.pool.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC,analysis_id DESC LIMIT 1',[cv.job_id])).rows[0];
 return{cv,job,analysis:latest?.analysis_json??null};
}
async function approvedBytes(cv){
 const root=await realpath('data/cv-v2'),target=await realpath(cv.pdf_path),relative=path.relative(root,target);
 if(relative.startsWith('..')||path.isAbsolute(relative)||path.extname(target).toLowerCase()!=='.pdf')throw new Error('CV_ARTIFACT_OUTSIDE_APPROVED_ROOT');
 const bytes=await readFile(target);
 if(bytes.length>5*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-'||digest(bytes)!==cv.sha256)throw new Error('CV_BYTES_CHANGED');
 return bytes;
}
async function invalidatePreviousProfile(repo,active){
 await repo.pool.query("UPDATE telegram_document_deliveries SET status='STALE',error_code='CV_PROFILE_CHANGED',updated_at=now() WHERE candidate_profile_id=$1 AND profile_hash<>$2 AND status IN('QUEUED','WAITING_CONFIGURATION','RETRY','CLAIMED')",[active.id,active.hash]);
}
export async function enqueueRegisteredCvDocuments({repo,profile,since}={}){
 if(!repo?.pool)throw new Error('DOCUMENT_REPOSITORY_REQUIRED');
 const active=activeProfile(profile);
 if(since!==undefined&&!Number.isFinite(new Date(since).getTime()))throw new Error('INVALID_DOCUMENT_DELIVERY_CUTOFF');
 await invalidatePreviousProfile(repo,active);
 const state=(await repo.pool.query(`INSERT INTO telegram_document_delivery_state(profile_hash,candidate_profile_id,cv_created_after)
  VALUES($1,$2,COALESCE($3::timestamptz,now())) ON CONFLICT(profile_hash) DO UPDATE SET profile_hash=EXCLUDED.profile_hash RETURNING cv_created_after`,[active.hash,active.id,since??null])).rows[0];
 const candidates=(await repo.pool.query(`SELECT c.cv_id FROM cv_versions c WHERE c.profile_version=$1 AND c.created_at>=$2
  AND c.qa_json->>'pass'='true' AND c.qa_json->'pdf'->'visual_review'->>'pass'='true'
  AND NOT EXISTS(SELECT 1 FROM telegram_document_deliveries d WHERE d.cv_id=c.cv_id AND d.pdf_sha256=c.sha256)
  ORDER BY c.created_at,c.cv_id LIMIT 200`,[active.hash,state.cv_created_after])).rows;
 const results=[];
 for(const item of candidates){
  const evidence=await currentEvidence(repo,item.cv_id);
  if(!evidence.cv){results.push({cv_id:item.cv_id,status:'CV_REGISTRATION_REMOVED'});continue;}
  if(!/^[a-f0-9]{64}$/.test(evidence.cv.sha256)){results.push({cv_id:item.cv_id,status:'BLOCKED',error_code:'CV_HASH_INVALID'});continue;}
  const verification=await verifyCurrentCvEvidence({...evidence,profile});
  const status=verification.pass?'QUEUED':'BLOCKED';
  const error=verification.pass?null:safeCode(verification.reasons[0]);
  const inserted=(await repo.pool.query(`INSERT INTO telegram_document_deliveries(delivery_id,cv_id,job_id,candidate_profile_id,profile_hash,pdf_sha256,status,error_code)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(cv_id,pdf_sha256) DO NOTHING RETURNING delivery_id,status`,
   [randomUUID(),evidence.cv.cv_id,evidence.cv.job_id,active.id,active.hash,evidence.cv.sha256,status,error])).rows[0];
  if(inserted)results.push(inserted);
 }
 return{scope:'REGISTERED_PRIVATE_CV_DOCUMENTS',queued:results.filter(r=>r.status==='QUEUED').length,blocked:results.filter(r=>r.status==='BLOCKED').length,results,cv_created_after:state.cv_created_after};
}
async function finish(repo,row,status,{error=null,messageId=null,delayMs=null}={}){
 const changed=(await repo.pool.query(`UPDATE telegram_document_deliveries SET status=$3,error_code=$4,telegram_message_id=$5,
  delivered_at=CASE WHEN $3='SENT' THEN now() ELSE delivered_at END,next_attempt_at=CASE WHEN $6::bigint IS NULL THEN NULL ELSE now()+$6*interval '1 millisecond' END,
  claim_until=NULL,updated_at=now() WHERE delivery_id=$1 AND claim_token=$2 AND status IN('CLAIMED','SENDING') RETURNING delivery_id,status,telegram_message_id`,
  [row.delivery_id,row.claim_token,status,error,messageId,delayMs])).rows[0];
 return changed??{delivery_id:row.delivery_id,status:'CLAIM_SUPERSEDED'};
}
async function claimNext(repo,active){
 const client=await repo.pool.connect();try{
  await client.query('BEGIN');
  const row=(await client.query(`SELECT * FROM telegram_document_deliveries WHERE profile_hash=$1 AND candidate_profile_id=$2
   AND status IN('QUEUED','WAITING_CONFIGURATION','RETRY') AND(next_attempt_at IS NULL OR next_attempt_at<=now())
   ORDER BY created_at,delivery_id FOR UPDATE SKIP LOCKED LIMIT 1`,[active.hash,active.id])).rows[0];
  if(!row){await client.query('COMMIT');return null;}
  const claimed=(await client.query("UPDATE telegram_document_deliveries SET status='CLAIMED',claim_token=$2,claim_until=now()+interval '5 minutes',updated_at=now() WHERE delivery_id=$1 RETURNING *",[row.delivery_id,randomUUID()])).rows[0];
  await client.query('COMMIT');return claimed;
 }catch{await client.query('ROLLBACK');throw new Error('DOCUMENT_CLAIM_FAILED');}finally{client.release();}
}
export async function drainRegisteredCvDocuments({repo,profile,telegram,limit=3}={}){
 if(!repo?.pool)throw new Error('DOCUMENT_REPOSITORY_REQUIRED');
 if(!Number.isInteger(limit)||limit<1||limit>20)throw new Error('INVALID_DOCUMENT_DELIVERY_LIMIT');
 const active=activeProfile(profile);await invalidatePreviousProfile(repo,active);
 // A crash before SENDING can safely retry. A crash during an HTTP send is ambiguous.
 await repo.pool.query("UPDATE telegram_document_deliveries SET status='DELIVERY_UNKNOWN',error_code='SEND_CONFIRMATION_LOST',claim_until=NULL,updated_at=now() WHERE status='SENDING' AND claim_until<now()");
 await repo.pool.query("UPDATE telegram_document_deliveries SET status='QUEUED',claim_token=NULL,claim_until=NULL,updated_at=now() WHERE status='CLAIMED' AND claim_until<now()");
 const configuration=configState(telegram);
 if(configuration){const waiting=(await repo.pool.query("UPDATE telegram_document_deliveries SET status='WAITING_CONFIGURATION',error_code=$3,updated_at=now() WHERE profile_hash=$1 AND candidate_profile_id=$2 AND status IN('QUEUED','WAITING_CONFIGURATION','RETRY') RETURNING delivery_id",[active.hash,active.id,configuration])).rows.length;
  return{scope:'PRIVATE_TELEGRAM_CV_DELIVERY',status:'WAITING_CONFIGURATION',error_code:configuration,waiting,sent:0,results:[]};}
 const results=[];
 for(let i=0;i<limit;i++){
  const row=await claimNext(repo,active);if(!row)break;
  const evidence=await currentEvidence(repo,row.cv_id);const verification=await verifyCurrentCvEvidence({...evidence,profile});
  if(!verification.pass||evidence.cv.sha256!==row.pdf_sha256){results.push(await finish(repo,row,'STALE',{error:safeCode(verification.reasons?.[0]??'CV_BYTES_CHANGED')}));continue;}
  let bytes;try{bytes=await approvedBytes(evidence.cv);}catch(error){results.push(await finish(repo,row,'BLOCKED',{error:safeCode(error.message)}));continue;}
  let caption;try{caption=registeredCvCaption(evidence.job,reviewUrl());}catch{results.push(await finish(repo,row,'BLOCKED',{error:'DOCUMENT_REVIEW_URL_INVALID'}));continue;}
  const form=new FormData();form.set('chat_id',String(telegram.chatId));form.set('caption',caption);
  form.set('document',new Blob([bytes],{type:'application/pdf'}),`CV-${String(evidence.job.job_id).slice(0,8)}.pdf`);
  const sending=(await repo.pool.query("UPDATE telegram_document_deliveries SET status='SENDING',telegram_chat_id=$3,sending_at=now(),attempt_count=attempt_count+1,updated_at=now() WHERE delivery_id=$1 AND claim_token=$2 AND status='CLAIMED' RETURNING delivery_id",[row.delivery_id,row.claim_token,String(telegram.chatId)])).rows[0];
  if(!sending){results.push({delivery_id:row.delivery_id,status:'CLAIM_SUPERSEDED'});continue;}
  let response,result;try{
   response=await telegram.fetch(`https://api.telegram.org/bot${telegram.token}/sendDocument`,{method:'POST',body:form,signal:AbortSignal.timeout(30000),redirect:'error'});
   result=await response.json();
  }catch{results.push(await finish(repo,row,'DELIVERY_UNKNOWN',{error:'SEND_FAILED_OR_AMBIGUOUS'}));continue;}
  if(!response.ok||result.ok!==true){
   if(result.ok===false&&Number(result.error_code)===429){const retrySeconds=Number(result.parameters?.retry_after??300);
    const delayMs=Number.isFinite(retrySeconds)?Math.max(300000,Math.min(86400000,retrySeconds*1000)):300000;
    results.push(await finish(repo,row,'RETRY',{error:'TELEGRAM_RATE_LIMIT',delayMs}));}
   else results.push(await finish(repo,row,result.ok===false?'FAILED':'DELIVERY_UNKNOWN',{error:result.ok===false?'TELEGRAM_REJECTED_DOCUMENT':'SEND_CONFIRMATION_MISSING'}));
   continue;
  }
  const message=result.result;
  if(!Number.isSafeInteger(message?.message_id)||message.message_id<1||String(message.chat?.id)!==String(telegram.chatId)||message.chat?.type!=='private'||
    typeof message.document?.file_id!=='string'||!message.document.file_id||message.caption!==caption){
   results.push(await finish(repo,row,'DELIVERY_UNKNOWN',{error:'PRIVATE_DOCUMENT_CONFIRMATION_MISSING'}));continue;
  }
  results.push(await finish(repo,row,'SENT',{messageId:message.message_id}));
 }
 return{scope:'PRIVATE_TELEGRAM_CV_DELIVERY',sent:results.filter(r=>r.status==='SENT').length,results};
}
