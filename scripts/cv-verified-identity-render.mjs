import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {chromium} from 'playwright';
import {PDFParse} from 'pdf-parse';
import {Repository} from '../services/core/repository.mjs';
import {factIndex} from '../services/core/fit.mjs';
import {cvIdentityQa,deterministicCvQa,renderCvV2Html,CV_V2_VERSION} from '../services/core/cv-v2.mjs';
import {reverifyMarketJob} from '../services/core/discovery-v2.mjs';
import {runObserved,observe,operationContext} from '../services/core/observability.mjs';

const canonical=value=>value && typeof value==='object' ? Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])) : value;
const clean=f=>Object.fromEntries(Object.entries(f).filter(([,v])=>v!==null&&v!=='UNKNOWN'));
const hash=value=>createHash('sha256').update(value).digest('hex');
if(process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT!=='false')throw new Error('Submission-disabled dry-run required');
const repository=new Repository();const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));
const identity=cvIdentityQa(profile);if(!identity.pass)throw new Error('Confirmed real identity required');
const sourceId=process.argv[2]??'158d0b6b-4492-49bc-af2c-663bf3f70505';
try {
  const stored=(await repository.pool.query('SELECT manifest_json FROM cv_drafts WHERE cv_id=$1',[sourceId])).rows[0]?.manifest_json;
  if(!stored?.qa?.claims?.pass)throw new Error('Previously independently verified real draft required');
  const oldMap=JSON.parse(await readFile(stored.source_map_path,'utf8'));
  const index=factIndex(profile);const facts=[...index.values()].map(clean);
  if(oldMap.facts.length!==facts.length||oldMap.facts.some(f=>JSON.stringify(canonical(f))!==JSON.stringify(canonical(clean(index.get(f.id))))))throw new Error('Authoritative fact ledger changed; fresh independent QA required');
  const oldDocument=JSON.parse(await readFile(stored.document_path,'utf8'));
  const document=Object.fromEntries(['headline','summary','skills','sections','application_text'].map(key=>[key,oldDocument[key]]));
  const deterministic=deterministicCvQa(document,profile);if(!deterministic.pass)throw new Error('Current deterministic fact QA failed');
  const job=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[stored.job_id])).rows[0];
  const analysis=(await repository.pool.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[stored.job_id])).rows[0]?.analysis_json;
  if(!['REVIEW','STRETCH'].includes(analysis?.decision))throw new Error('Actual non-rejected REVIEW/STRETCH required');
  const open=await reverifyMarketJob({job,repository});if(open.status!=='OPEN')throw new Error('Posting not currently OPEN');
  const cvId=randomUUID();const slug=String(job.company).replace(/[^a-zA-Z0-9_-]/g,'_');
  const dir=path.resolve('data/cv-v2',new Date().toISOString().slice(0,7),slug,job.job_id,cvId);await mkdir(dir,{recursive:true});
  const manifest={...stored,cv_id:cvId,profile_version:hash(JSON.stringify(profile)),template_version:CV_V2_VERSION,created_at:new Date().toISOString(),
    generation_method:'VERIFIED_CONTENT_IDENTITY_RENDER',reused_from_cv_id:sourceId,model_requests_this_render:0,status:'PENDING_VISUAL_QA',
    source_operation_run_id:stored.operation_run_id,
    pdf_path:path.join(dir,'cv.pdf'),html_path:path.join(dir,'cv.html'),document_path:path.join(dir,'cv.json'),source_map_path:path.join(dir,'source-fact-map.json'),manifest_path:path.join(dir,'manifest.json'),
    open_verification:open,application_eligible:false,application_policy_blocker:job.company==='Canonical'?'EMPLOYER_REQUIRES_OWN_WORDS_NO_AI_GENERATED_CONTENT':null,
    acceptance_scope:job.company==='Canonical'?'DOCUMENT_DEMO_POLICY_BLOCKED':'REAL_REVIEW_DOCUMENT',
    qa:{pass:false,identity:{pass:true,status:'PASS',missing:[]},claims:{...stored.qa.claims,deterministic,fact_ledger_unchanged:true,semantic:{...stored.qa.claims.semantic,reused_from_cv_id:sourceId}},pdf:{pass:false}}};
  await runObserved(repository,4,{job_id:job.job_id},async()=>{
    manifest.operation_run_id=operationContext.getStore()?.run_id??null;
    await observe(repository,{event:'CV_VERIFIED_CONTENT_RENDER_STARTED',entity_type:'job',entity_id:job.job_id,message:'Rendering confirmed identity with unchanged independently verified claim ledger',model_requests:0});
    const html=renderCvV2Html(document,profile,stored.language,identity.identity);
    await writeFile(manifest.html_path,html);await writeFile(manifest.document_path,JSON.stringify({...document,target_job_id:job.job_id,language:stored.language,identity:identity.identity},null,2));
    const browser=await chromium.launch({headless:true,args:['--disable-gpu']});let visual;
    try{const page=await browser.newPage();await page.setContent(html);await page.emulateMedia({media:'print'});visual=await page.evaluate(()=>({no_horizontal_overflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth,headings_visible:[...document.querySelectorAll('h1,h2,h3')].every(e=>e.getBoundingClientRect().width>0)}));await page.pdf({path:manifest.pdf_path,format:'A4',printBackground:true});}finally{await browser.close();}
    const buffer=await readFile(manifest.pdf_path);const parser=new PDFParse({data:buffer});let parsed,raster;
    try{parsed=await parser.getText();raster=await parser.getScreenshot({desiredWidth:1200,imageBuffer:true,imageDataUrl:false});}finally{await parser.destroy();}
    const previews=[];for(const page of raster.pages){const target=manifest.pdf_path.replace(/\.pdf$/,`.page-${page.pageNumber}.png`);await writeFile(target,page.data);previews.push(target);}
    const qa={nonempty:buffer.length>0,name_present:parsed.text.includes(identity.identity.name),contacts_present:[identity.identity.email,identity.identity.phone].every(value=>parsed.text.includes(value)),no_placeholders:!/(?:UNKNOWN|\{\{|TODO|PLACEHOLDER)/.test(parsed.text),page_count:parsed.total,visual_sanity:visual,preview_paths:previews,pdf_pages_rendered:raster.pages.length===parsed.total,visual_review:'PENDING'};
    qa.pass=qa.nonempty&&qa.name_present&&qa.contacts_present&&qa.no_placeholders&&qa.page_count>=1&&qa.page_count<=2&&Object.values(visual).every(Boolean)&&qa.pdf_pages_rendered;manifest.qa.pdf=qa;manifest.sha256=hash(buffer);
    if(!qa.pass)manifest.status='BLOCKED_PDF';
    await writeFile(manifest.source_map_path,JSON.stringify({...oldMap,profile_version:manifest.profile_version,facts},null,2));
    await writeFile(manifest.manifest_path,JSON.stringify(manifest,null,2));await repository.recordCvDraft(manifest);
    await observe(repository,{event:'CV_VERIFIED_CONTENT_RENDER_COMPLETED',entity_type:'cv',entity_id:cvId,message:manifest.status,pages:qa.page_count,model_requests:0});
    return {generated:1,cv_id:cvId,status:manifest.status,blocked_reason:manifest.status,pdf_pass:qa.pass,reused_verified_claims:true,model_requests:0};
  },{trigger:'identity_cv_gate',mode:'REAL'});
  console.log(JSON.stringify({cv_id:cvId,status:manifest.status,pdf_pass:manifest.qa.pdf.pass,pages:manifest.qa.pdf.page_count,pdf_path:manifest.pdf_path,preview_paths:manifest.qa.pdf.preview_paths,application_eligible:false,application_policy_blocker:manifest.application_policy_blocker}));
}finally{await repository.close();}
