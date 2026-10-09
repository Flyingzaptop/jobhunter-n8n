import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {PDFParse} from 'pdf-parse';
const sha=value=>createHash('sha256').update(value).digest('hex');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function coverLetterAsset({repository,application,job,cv,profile}){
 const existing=application.last_state?.application_documents?.cover_letter;
 if(existing?.cv_sha256===cv.sha256){try{if(sha(await readFile(existing.path))===existing.sha256)return existing;}catch{}}
 const documentBytes=await readFile(cv.manifest_json.document_path);
 if(cv.qa_json.pdf.visual_review?.document_sha256&&sha(documentBytes)!==cv.qa_json.pdf.visual_review.document_sha256)throw Error('CV_DOCUMENT_CHANGED');
 const document=JSON.parse(documentBytes),name=profile.onboarding.legal_name,email=profile.onboarding.email;
 const paragraphs=[`Please consider my application for ${job.title} at ${job.company}.`,...document.summary.map(c=>c.text),
  ...document.sections.slice(0,2).flatMap(s=>s.bullets.slice(0,1).map(b=>b.text)),
  'I would welcome an opportunity to discuss how this background relates to the role.'];
 const html=`<!doctype html><meta charset="utf-8"><style>@page{size:A4;margin:22mm}body{font:11pt Arial;line-height:1.5;color:#172935}h1{font-size:20pt}p{margin:12px 0}</style><h1>${escape(name)}</h1><p>${escape(email)} · ${escape(profile.onboarding.phone)}</p><h2>Application: ${escape(job.title)}</h2>${paragraphs.map(p=>`<p>${escape(p)}</p>`).join('')}<p>${escape(name)}</p>`;
 const target=path.join(path.dirname(cv.pdf_path),'cover-letter.pdf'),browser=await chromium.launch({headless:true,args:['--disable-gpu']});
 try{const page=await browser.newPage();await page.setContent(html);await page.pdf({path:target,format:'A4',printBackground:true});}finally{await browser.close();}
 const bytes=await readFile(target),parser=new PDFParse({data:bytes});try{const text=await parser.getText();if(text.total!==1||!text.text.includes(name)||!text.text.includes(email))throw Error('COVER_LETTER_PDF_QA_FAILED');}finally{await parser.destroy();}
 const asset={path:target,sha256:sha(bytes),cv_sha256:cv.sha256,paragraphs,method:'VERIFIED_CV_CLAUSES_AND_USER_AUTHORIZED_APPLICATION_INTENT'};
 await repository.pool.query('UPDATE applications SET last_state=last_state||$2::jsonb WHERE application_id=$1',[application.application_id,{application_documents:{cover_letter:asset}}]);
 application.last_state={...application.last_state,application_documents:{cover_letter:asset}};return asset;
}
