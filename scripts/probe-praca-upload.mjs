import {Repository} from '../services/core/repository.mjs';import {BrowserClient} from '../services/core/application.mjs';
import {browserConfig,createBrowserService} from '../services/browser-service/server.mjs';
import {settleApplicationForm} from '../services/core/form-settling.mjs';
import {verifyCurrentCvEvidence} from '../services/core/cv-evidence.mjs';
import {randomUUID} from 'node:crypto';import path from 'node:path';import {mkdir,writeFile,readFile} from 'node:fs/promises';import YAML from 'yaml';
const id=process.argv[2];if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id??''))throw new Error('APPLICATION_UUID_REQUIRED');
if(process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT!=='false')throw new Error('CONTROLLED_DRY_RUN_REQUIRED');
const repository=new Repository();let service;
try{
 const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));
 const row=(await repository.pool.query('SELECT a.job_id,a.cv_id,c.pdf_path,c.sha256,j.application_url FROM applications a JOIN jobs j USING(job_id) JOIN cv_versions c ON c.cv_id=a.cv_id WHERE a.application_id=$1 AND a.candidate_profile_id=$2 AND a.dry_run=true AND a.status NOT IN (\'SUBMITTING\',\'SUBMITTED\',\'SUBMISSION_UNKNOWN\') AND c.qa_json->>\'pass\'=\'true\'',[id,profile.profile_id])).rows[0];
 if(!row||new URL(row.application_url).hostname!=='www.praca.pl')throw new Error('VERIFIED_PRACA_DRAFT_REQUIRED');
 const [cv,job,latest]=await Promise.all([repository.pool.query('SELECT * FROM cv_versions WHERE cv_id=$1',[row.cv_id]),repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[row.job_id]),repository.pool.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[row.job_id])]);
 if(!(await verifyCurrentCvEvidence({cv:cv.rows[0],job:job.rows[0],analysis:latest.rows[0]?.analysis_json,profile})).pass)throw new Error('CURRENT_CV_EVIDENCE_REQUIRED');
 const directory=path.resolve('data/browser-upload-probes',randomUUID());await mkdir(directory,{recursive:true});
 const token=randomUUID();service=await createBrowserService({...browserConfig(),host:'127.0.0.1',port:0,token,stateRoot:directory,dryRun:true,allowRealSubmit:false,allowMockSubmit:false});await service.listen();
 const browser=new BrowserClient({baseUrl:`http://127.0.0.1:${service.server.address().port}`,token});
 const opened=await browser.call('/sessions',{application_id:id,url:row.application_url});const session=opened.session_id;
 await browser.call(`/sessions/${session}/navigate`,{url:`https://www.praca.pl/apply/internal/${new URL(row.application_url).pathname.match(/_(\d+)\.html$/)?.[1]}.html`});
 const view=await settleApplicationForm({browser,sessionId:session,initialView:opened.snapshot});
 const file=view.fields.find(f=>f.type==='file'&&/\bcv\b/i.test(f.label));if(!file)throw new Error('CV_FIELD_NOT_FOUND');
 let responseShape=null,requestShape=null;
 service.sessions.get(session).page.on('request',request=>{
  if(new URL(request.url()).pathname!=='/applying/upload-file')return;
  const body=request.postDataBuffer();requestShape={content_type:request.headers()['content-type'],bytes:body?.length??null,has_pdf_marker:body?.includes(Buffer.from('%PDF-'))??false};
  try{const value=JSON.parse(body.toString('utf8'));requestShape.json_fields=Object.keys(value);requestShape.value_types=Object.fromEntries(Object.entries(value).map(([key,value])=>[key,typeof value]));requestShape.file_fields=value.file&&typeof value.file==='object'?Object.keys(value.file):null;
   requestShape.file_shape=value.file&&typeof value.file==='object'?Object.fromEntries(Object.entries(value.file).map(([key,value])=>[key,{type:typeof value,...(typeof value==='string'?{length:value.length,data_uri:value.startsWith('data:application/pdf;base64,'),pdf_name:value==='cv.pdf',pdf_type:value==='application/pdf'}:{})}])):null;
  }catch{}
 });
 service.sessions.get(session).page.on('response',async response=>{if(new URL(response.url()).pathname==='/applying/upload-file')try{const value=await response.json();responseShape={status:response.status(),api_status:typeof value.status==='string'&&value.status.length>20?null:value.status,name_matches_cv:value.data?.name==='cv.pdf',id_type:typeof value.data?.id,fields:Object.keys(value),nested:Object.fromEntries(Object.entries(value).filter(([,v])=>v&&typeof v==='object').map(([k,v])=>[k,Object.keys(v)]))};}catch{responseShape={status:response.status(),json:false};}});
 await browser.call(`/sessions/${session}/upload`,{selector:file.selector,path:row.pdf_path,sha256:row.sha256});await new Promise(resolve=>setTimeout(resolve,2500));
 const after=await browser.call(`/sessions/${session}/snapshot`);
 const finalControlShapes=await service.sessions.get(session).page.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>/^wyślij$/i.test(e.innerText?.trim()??'')&&e.getBoundingClientRect().width>0).slice(-6).map(e=>({tag:e.tagName,type:e.getAttribute('type'),role:e.getAttribute('role'),in_form:!!e.closest('form'),attributes:[...e.attributes].map(a=>a.name),parent_tag:e.parentElement?.tagName})));
 const result={scope:'REAL_PRACA_UPLOAD_ONLY_NO_APPLICATION_SUBMIT',application_id:id,job_id:row.job_id,request_shape:requestShape,response_shape:responseShape,upload:after.uploaded_file_hashes,final_control_shapes:finalControlShapes,blocked_uploads:after.blocked_requests.filter(r=>new URL(r.url).pathname==='/applying/upload-file'),real_employer_submissions:0};
 await writeFile(path.join(directory,'receipt.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
}finally{if(service)await service.close();await repository.close();}
