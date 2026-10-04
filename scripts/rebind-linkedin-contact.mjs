import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {verifyCurrentCvEvidence} from '../services/core/cv-evidence.mjs';
import {deterministicCvQa} from '../services/core/cv-v2.mjs';
import {rebindContactMetadata} from './contact-rebind-helper.mjs';

const targets=[['55f8b831-91dc-5b6b-a173-7c24d9e9f4ba','1de99092-4632-4615-9d13-7bf679993b0b'],['b083e564-e351-570a-b11c-5ab752d7f190','f3179b6f-80c0-4efe-96ee-e6b3e080efb3'],['7eacc682-d769-5edd-96d4-537ee4d06e7b','e026e2f2-9bed-4814-ad30-1f50fc619dca']];
if(process.argv[2]!=='--apply'||process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT!=='false')throw new Error('Explicit --apply and submission-disabled dry-run required');
const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));
const repository=new Repository(),client=await repository.pool.connect(),files=[],samples=[];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
let committed=false;
try{
 await client.query('BEGIN');
 for(const [jobId,cvId] of targets){
  const job=(await client.query('SELECT * FROM jobs WHERE job_id=$1 FOR UPDATE',[jobId])).rows[0];
  const row=(await client.query('SELECT * FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE',[jobId])).rows[0];
  const cv=(await client.query('SELECT * FROM cv_versions WHERE cv_id=$1 AND job_id=$2 FOR UPDATE',[cvId,jobId])).rows[0];
  if(!row||!cv||!job)throw new Error('Bounded target evidence missing');
  const rebound=rebindContactMetadata({profile,analysis:row.analysis_json,manifest:cv.manifest_json,at:new Date().toISOString()});
  const oldCheck=await verifyCurrentCvEvidence({cv,job,profile:rebound.prior,analysis:row.analysis_json});
  if(!oldCheck.pass)throw new Error(`Original evidence failed: ${oldCheck.reasons.join(',')}`);
  const manifest=cv.manifest_json;
  const documentBytes=await readFile(manifest.document_path),htmlBytes=await readFile(manifest.html_path),pdfBytes=await readFile(cv.pdf_path);
  if(!deterministicCvQa(JSON.parse(documentBytes),profile).pass)throw new Error('Unchanged document qualifications failed current deterministic QA');
  const diskManifest=JSON.parse(await readFile(manifest.manifest_path));
  if(diskManifest.profile_hash!==manifest.profile_hash||diskManifest.analysis_hash!==manifest.analysis_hash||diskManifest.sha256!==cv.sha256)throw new Error('Disk/DB artifact bindings differ');
  const sourceBytes=await readFile(manifest.source_map_path),source=JSON.parse(sourceBytes);
  if(source.profile_hash!==manifest.profile_hash||source.job_content_hash!==job.content_hash||source.analysis_hash!==manifest.analysis_hash||source.analysis_input_hash!==row.analysis_json.fit_input_hash)throw new Error('Source fact map binding mismatch');
  rebound.audit.artifact_sha256={pdf:digest(pdfBytes),html:digest(htmlBytes),document:digest(documentBytes),original_source_map:digest(sourceBytes)};
  // Artifact receipts belong to the manifest/event. The analysis has a separate
  // immutable contact audit, preserving its already computed canonical digest.
  rebound.manifest.contact_rebinding=structuredClone(rebound.audit);
  const nextSource={...source,profile_hash:rebound.manifest.profile_hash,profile_version:rebound.manifest.profile_version,analysis_hash:rebound.manifest.analysis_hash,contact_rebinding:rebound.audit};
  for(const [name,value] of [[manifest.manifest_path,rebound.manifest],[manifest.source_map_path,nextSource]]){
   files.push({path:name,bytes:await readFile(name)});await writeFile(name,JSON.stringify(value,null,2));
  }
  const nextCv={...cv,profile_version:rebound.manifest.profile_version,manifest_json:rebound.manifest};
  const check=await verifyCurrentCvEvidence({cv:nextCv,job,profile,analysis:rebound.analysis});
  if(!check.pass)throw new Error(`Rebound evidence failed: ${check.reasons.join(',')}`);
  for(const [name,hash] of [[cv.pdf_path,digest(pdfBytes)],[manifest.html_path,digest(htmlBytes)],[manifest.document_path,digest(documentBytes)]])if(digest(await readFile(name))!==hash)throw new Error('CV content changed during metadata rebinding');
  await client.query('UPDATE job_analysis SET analysis_json=$2 WHERE analysis_id=$1',[row.analysis_id,rebound.analysis]);
  await client.query('UPDATE cv_versions SET profile_version=$2,manifest_json=$3 WHERE cv_id=$1',[cvId,rebound.manifest.profile_version,rebound.manifest]);
  await client.query('UPDATE cv_drafts SET manifest_json=$2 WHERE cv_id=$1',[cvId,rebound.manifest]);
  await client.query('INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json) VALUES($1,$2,$3,$4,$5)',[randomUUID(),'cv',cvId,'CV_CONTACT_METADATA_REBOUND',{...rebound.audit,analysis_id:row.analysis_id,cv_id:cvId,job_id:jobId}]);
  samples.push({job_id:jobId,cv_id:cvId,analysis_id:row.analysis_id,current_evidence_pass:check.pass,pdf_sha256:cv.sha256,inference_performed:false,pdf_modified:false});
 }
 await client.query('COMMIT');committed=true;
 await mkdir('tests/results',{recursive:true});
 await writeFile('tests/results/contact-rebinding.json',JSON.stringify({status:'PASS',scope:'THREE_EXISTING_REAL_CVS_CONTACT_METADATA_ONLY',at:new Date().toISOString(),new_inference_count:0,samples},null,2));
 console.log(JSON.stringify({status:'PASS',new_inference_count:0,samples}));
}catch(error){
 if(!committed){await client.query('ROLLBACK');for(const file of files.reverse())await writeFile(file.path,file.bytes);}
 throw error;
}finally{client.release();await repository.close();}
