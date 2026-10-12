import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {getDocument,Util} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {cvIdentityQa,deterministicCvQa,cvClaimCatalog,cvTailoringQa,selectCatalog,CV_V2_VERSION} from './cv-v2.mjs';
import {verifyExtractiveCv} from './cv-extractive.mjs';
import {canonicalAnalysisHash} from './evidence-hash.mjs';

const exec=promisify(execFile),hash=value=>createHash('sha256').update(Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const REVIEWER='AUTOMATED_INDEPENDENT_RENDER_QA';
const inside=(root,target)=>{const rel=path.relative(root,target);return !rel.startsWith('..')&&!path.isAbsolute(rel);};
const normalized=value=>String(value??'').replace(/\s+/g,' ').trim();
export const normalizePdfClaimText=value=>normalized(value).replace(/-\s+(?=[\p{L}\p{N}])/gu,'-');

/** Geometry checks are intentionally independent of the HTML/CSS DOM checks. */
export function checkPdfGeometry(pages){const reasons=[];let words=0,overlaps=0,minHeight=Infinity;
 if(!Array.isArray(pages)||pages.length<1||pages.length>2)return {pass:false,reasons:['PDF_PAGE_COUNT'],pages:pages?.length??0};
 for(const page of pages){if(!Number.isFinite(page.width)||!Number.isFinite(page.height)||page.width<100||page.height<100){reasons.push('INVALID_PAPER_DIMENSIONS');continue;}
  const boxes=(page.boxes??[]).filter(box=>normalized(box.text));
  if(!boxes.length)reasons.push('PDF_PAGE_NO_TEXT');
  for(const box of boxes){words+=normalized(box.text).split(' ').length;minHeight=Math.min(minHeight,box.height);
   if(![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<6||box.height>90)reasons.push('ILLEGIBLE_TEXT_GEOMETRY');
   if(box.x<1||box.y<1||box.x+box.width>page.width-1||box.y+box.height>page.height-1)reasons.push('TEXT_OUTSIDE_PAPER');
  }
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
   const a=boxes[i],b=boxes[j],dx=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),dy=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
   if(dx>1&&dy>Math.min(a.height,b.height)*.65&&dx*dy>Math.min(a.width*a.height,b.width*b.height)*.12)overlaps++;
  }
 }
 if(overlaps)reasons.push('TEXT_RECTANGLE_OVERLAP');
 return {pass:reasons.length===0,reasons:[...new Set(reasons)],pages:pages.length,word_count:words,overlap_count:overlaps,min_text_height_pt:Number.isFinite(minHeight)?minHeight:null};
}

export function checkCvBindings({manifest,job,profile,analysis}){const reasons=[];const profileHash=hash(profile);const sourcePending=manifest?.source_verification_required===true&&job?.availability_status!=='CLOSED'&&manifest?.application_eligible===false;
 if(job?.availability_status!=='OPEN'&&!sourcePending)reasons.push('CURRENT_OFFICIAL_SOURCE_NOT_OPEN');
 if(manifest?.job_id!==job?.job_id)reasons.push('CV_JOB_MISMATCH');
 if(manifest?.status!=='PASS'||!manifest.qa?.pass||!manifest.qa.claims?.pass||!manifest.qa.identity?.pass||!manifest.qa.pdf?.pass)reasons.push('EXISTING_CV_QA_REQUIRED');
 if(manifest?.profile_hash!==profileHash||manifest?.profile_version!==profileHash)reasons.push('CV_PROFILE_CHANGED');
 if(!job?.content_hash||manifest?.job_content_hash!==job.content_hash)reasons.push('CV_SOURCE_CHANGED');
 if(!analysis||analysis.profile_hash!==profileHash||analysis.job_content_hash!==job?.content_hash
  ||!['REVIEW','STRETCH','AUTO_APPLY'].includes(analysis.decision)||!analysis.requirements?.length||analysis.overall_fit==null||analysis.hard_blockers?.length)reasons.push('CURRENT_NON_BLOCKED_ANALYSIS_REQUIRED');
 if(manifest?.analysis_hash!==canonicalAnalysisHash(analysis))reasons.push('CV_ANALYSIS_CHANGED');
 if(manifest?.application_eligible!==true&&!sourcePending||Object.hasOwn(manifest??{},'application_policy_blocker'))reasons.push('CV_NOT_EMPLOYER_READY');
 return {pass:reasons.length===0,reasons};
}

async function pdfGeometry(bytes){const loading=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,disableFontFace:true});const pdf=await loading.promise;
 try{const pages=[];for(let n=1;n<=pdf.numPages;n++){
  const page=await pdf.getPage(n),viewport=page.getViewport({scale:1}),content=await page.getTextContent();
  const boxes=content.items.filter(item=>typeof item.str==='string'&&item.str.trim()).map(item=>{
   const transform=Util.transform(viewport.transform,item.transform),height=Math.hypot(transform[2],transform[3]);
   return {text:item.str,x:transform[4],y:transform[5]-height,width:item.width,height};
  });pages.push({width:viewport.width,height:viewport.height,boxes});
 }return pages;}finally{await pdf.destroy();}}

async function rasterProof(pdfPath,pageCount,{popplerBinDir=process.env.POPPLER_BIN_DIR,proofRoot}){
 if(!popplerBinDir)throw new Error('POPPLER_BIN_DIR_REQUIRED');
 const binary=path.join(popplerBinDir,process.platform==='win32'?'pdftoppm.exe':'pdftoppm');
 await mkdir(proofRoot,{recursive:true});const proofs=[];
 for(let page=1;page<=pageCount;page++){
  const prefix=path.join(proofRoot,'page-'+page);
  await exec(binary,['-f',String(page),'-l',String(page),'-singlefile','-r','96','-png',pdfPath,prefix],{timeout:60000,windowsHide:true,maxBuffer:1024*1024});
  await exec(binary,['-f',String(page),'-l',String(page),'-singlefile','-r','96',pdfPath,prefix],{timeout:60000,windowsHide:true,maxBuffer:1024*1024});
  const png=await readFile(prefix+'.png'),ppm=await readFile(prefix+'.ppm');
  if(!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||png.length<100)throw new Error('INVALID_RENDERED_PNG');
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
  const header=ppm.subarray(0,128).toString('ascii').match(/^P6\s+(\d+)\s+(\d+)\s+255\s/);
  if(!header||Number(header[1])!==width||Number(header[2])!==height||width<500||height<500
   ||ppm.length-header[0].length!==width*height*3)throw new Error('INVALID_RENDERED_RASTER');
  let ink=0;for(let i=header[0].length;i<ppm.length;i+=3)if(Math.min(ppm[i],ppm[i+1],ppm[i+2])<160)ink++;
  if(ink<100)throw new Error('RENDERED_PAGE_BLANK');
  proofs.push({page,width,height,ink_pixels:ink,png_sha256:hash(png),ppm_sha256:hash(ppm),path:prefix+'.png'});
 }return proofs;
}

/** Audit only: no manifest or database approval mutation, and no model calls. */
export async function auditIndependentCv({manifest,job,profile,analysis,artifactRoot='data/cv-v2',proofRoot,
 popplerBinDir=process.env.POPPLER_BIN_DIR,geometryReader=pdfGeometry,renderer=rasterProof}){
 const binding=checkCvBindings({manifest,job,profile,analysis});if(!binding.pass)return binding;
 const identity=cvIdentityQa(profile);if(!identity.pass)return {pass:false,reasons:['CURRENT_IDENTITY_REQUIRED']};
 try{const root=await realpath(artifactRoot),pdf=await realpath(manifest.pdf_path),documentPath=await realpath(manifest.document_path),mapPath=await realpath(manifest.source_map_path);
  const manifestPath=await realpath(manifest.manifest_path),htmlPath=await realpath(manifest.html_path);
  if([pdf,documentPath,mapPath,manifestPath,htmlPath].some(target=>!inside(root,target))||path.extname(pdf).toLowerCase()!=='.pdf')return {pass:false,reasons:['CV_ARTIFACT_OUTSIDE_APPROVED_ROOT']};
  const [bytes,documentBytes,mapBytes]=await Promise.all([readFile(pdf),readFile(documentPath),readFile(mapPath)]);
  if(bytes.length>5*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-'||hash(bytes)!==manifest.sha256)return {pass:false,reasons:['CV_BYTES_CHANGED']};
  const document=JSON.parse(documentBytes);if(!deterministicCvQa(document,profile).pass)return {pass:false,reasons:['CURRENT_DETERMINISTIC_CLAIMS_FAILED']};
  if(manifest.template_version===CV_V2_VERSION){const target=cvTailoringQa(document,profile,analysis,job);if(!target.pass||target.target_requirements_hash!==manifest.keyword_coverage?.requirements_hash)return {pass:false,reasons:['EXACT_VACANCY_KEYWORD_QA_FAILED']};}
  if(manifest.generation_method==='EXTRACTIVE_VACANCY_TAILORING'&&!verifyExtractiveCv(document,profile,selectCatalog(profile,analysis,job).skills).pass)return {pass:false,reasons:['EXACT_SOURCE_CLAIMS_CHANGED']};
  const sourceMap=JSON.parse(mapBytes),claims=cvClaimCatalog(document);
  if(sourceMap.profile_hash!==hash(profile)||sourceMap.job_content_hash!==job.content_hash||sourceMap.analysis_hash!==canonicalAnalysisHash(analysis)
   ||hash(sourceMap.claims)!==hash(claims))return {pass:false,reasons:['CV_SOURCE_MAP_CHANGED']};
  const pages=await geometryReader(bytes),geometry=checkPdfGeometry(pages);if(!geometry.pass)return geometry;
  if(pages.length!==manifest.qa.pdf.page_count)return {pass:false,reasons:['PAGE_COUNT_CHANGED']};
  const text=normalized(pages.flatMap(page=>page.boxes.map(box=>box.text)).join(' '));
  if(![identity.identity.name,identity.identity.email,identity.identity.phone].every(value=>text.includes(normalized(value))))return {pass:false,reasons:['PDF_IDENTITY_NOT_VISIBLE']};
  if(/UNKNOWN|\{\{|TODO|PLACEHOLDER/.test(text))return {pass:false,reasons:['PDF_PLACEHOLDER_VISIBLE']};
  if(claims.some(claim=>!normalizePdfClaimText(text).includes(normalizePdfClaimText(claim.text))))return {pass:false,reasons:['PDF_CLAIM_NOT_VISIBLE']};
  const proofs=await renderer(pdf,pages.length,{popplerBinDir,proofRoot:proofRoot??path.join(path.dirname(pdf),'independent-render-qa')});
  if(proofs.length!==pages.length)return {pass:false,reasons:['ALL_RENDERED_PAGES_REQUIRED']};
  return {pass:true,reasons:[],reviewer:REVIEWER,method:'PDFJS_TEXT_GEOMETRY_AND_INDEPENDENT_POPPLER_PNG_PPM',
   pages_reviewed:pages.length,geometry,rendered_pages:proofs,pdf_sha256:hash(bytes),document_sha256:hash(documentBytes),source_map_sha256:hash(mapBytes),
   profile_hash:hash(profile),job_content_hash:job.content_hash,analysis_hash:canonicalAnalysisHash(analysis),at:new Date().toISOString()};
 }catch(error){return {pass:false,reasons:[/^[A-Z_]+$/.test(error.message)?error.message:'INDEPENDENT_QA_FAILED']};}
}

export async function registerIndependentCv({repository,manifest,profile,artifactRoot='data/cv-v2',popplerBinDir=process.env.POPPLER_BIN_DIR}){
 if(process.env.CV_AUTOMATED_RENDER_QA_ENABLED!=='true')return {status:'DRAFT_PENDING_VISUAL',cv_id:manifest.cv_id};
 const client=await repository.pool.connect();
 try{await client.query('BEGIN');
  const job=(await client.query('SELECT * FROM jobs WHERE job_id=$1 FOR UPDATE',[manifest.job_id])).rows[0];
  const analysis=(await client.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC,analysis_id DESC LIMIT 1',[manifest.job_id])).rows[0]?.analysis_json;
  const proof=await auditIndependentCv({manifest,job,profile,analysis,artifactRoot,popplerBinDir});
  if(!proof.pass){await client.query('ROLLBACK');return {status:'DRAFT_PENDING_VISUAL',cv_id:manifest.cv_id,qa_reasons:proof.reasons};}
  const [bytes,documentBytes,mapBytes]=await Promise.all([readFile(manifest.pdf_path),readFile(manifest.document_path),readFile(manifest.source_map_path)]);
  if(hash(bytes)!==proof.pdf_sha256||hash(documentBytes)!==proof.document_sha256||hash(mapBytes)!==proof.source_map_sha256)throw new Error('CV_BYTES_CHANGED');
  const approved=structuredClone(manifest);approved.qa.pdf.visual_review=proof;
  await client.query(`INSERT INTO cv_versions(cv_id,job_id,profile_version,template_version,model,pdf_path,html_path,sha256,qa_json,manifest_json)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(cv_id) DO UPDATE SET qa_json=EXCLUDED.qa_json,manifest_json=EXCLUDED.manifest_json`,
   [approved.cv_id,approved.job_id,approved.profile_version,approved.template_version,approved.model,approved.pdf_path,approved.html_path,approved.sha256,approved.qa,approved]);
  await client.query('UPDATE cv_drafts SET status=$2,manifest_json=$3 WHERE cv_id=$1',[approved.cv_id,approved.status,approved]);
  await client.query('COMMIT');await writeFile(approved.manifest_path,JSON.stringify(approved,null,2));
  await client.query('INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json)VALUES($1,$2,$3,$4,$5)',[randomUUID(),'cv',approved.cv_id,'CV_AUTOMATED_RENDER_QA_PASSED',{reviewer:REVIEWER,pages:proof.pages_reviewed,pdf_sha256:proof.pdf_sha256}]);
  return {status:'REGISTERED',cv_id:approved.cv_id};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
