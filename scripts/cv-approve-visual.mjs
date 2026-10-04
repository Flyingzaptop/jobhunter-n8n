import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {cvIdentityQa,deterministicCvQa} from '../services/core/cv-v2.mjs';
import {runObserved,observe,operationContext} from '../services/core/observability.mjs';

// Only invoke after actual rendered page inspection. This script records that
// completed inspection; it cannot substitute for viewing the pages.
const ids=(process.argv[2]??'').split(',');
if(ids.some(id=>!/^[0-9a-f-]{36}$/i.test(id))||process.argv[3]!=='--rendered-pages-inspected')throw new Error('Explicit actual page-inspection evidence required');
if(process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT!=='false')throw new Error('Submission-disabled dry-run required');
const repository=new Repository();const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
try {
  for(const id of ids) {
    const manifest=(await repository.pool.query('SELECT manifest_json FROM cv_drafts WHERE cv_id=$1',[id])).rows[0]?.manifest_json;
    if(!manifest?.qa?.claims?.pass||!manifest.qa.identity.pass||!manifest.qa.pdf.pass)throw new Error('Actual factual/identity/PDF QA must pass before visual approval');
    if(manifest.profile_version!==hash(JSON.stringify(profile))||!cvIdentityQa(profile).pass)throw new Error('Profile changed since generation');
    const document=JSON.parse(await readFile(manifest.document_path,'utf8'));
    if(!deterministicCvQa(document,profile).pass)throw new Error('Current deterministic facts failed');
    if(hash(await readFile(manifest.pdf_path))!==manifest.sha256)throw new Error('PDF changed since rendering');
    if(manifest.qa.pdf.page_count!==manifest.qa.pdf.preview_paths.length)throw new Error('All PDF pages must have corresponding rendered evidence');
    for(const preview of manifest.qa.pdf.preview_paths)if((await readFile(preview)).length<100)throw new Error('Rendered preview missing');
    await runObserved(repository,4,{cv_id:id},async()=>{
      const originalRun=manifest.operation_run_id;manifest.visual_operation_run_id=operationContext.getStore()?.run_id??null;
      if(manifest.generation_method==='VERIFIED_CONTENT_IDENTITY_RENDER') {
        const event=(await repository.pool.query("SELECT payload_json->>'run_id' AS run_id FROM events WHERE entity_id=$1 AND event_type='CV_VERIFIED_CONTENT_RENDER_COMPLETED' ORDER BY created_at DESC LIMIT 1",[id])).rows[0];
        if(event?.run_id && event.run_id!==originalRun){manifest.source_operation_run_id=originalRun;manifest.operation_run_id=event.run_id;}
      }
      manifest.qa.pdf.visual_review={pass:true,reviewer:'codex_pdf_visual_inspection',pages_reviewed:manifest.qa.pdf.page_count,at:new Date().toISOString(),checks:['legible_text','no_overlap_or_clipping','consistent_sections','identity_and_contacts_visible','provenance_and_degree_status_visible']};
      manifest.qa.pass=true;manifest.status='PASS';
      if(manifest.application_policy_blocker)manifest.application_eligible=false;
      await writeFile(manifest.manifest_path,JSON.stringify(manifest,null,2));await repository.recordCvDraft(manifest);
      await repository.pool.query(`INSERT INTO cv_versions(cv_id,job_id,profile_version,template_version,model,pdf_path,html_path,sha256,qa_json,manifest_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(cv_id) DO UPDATE SET qa_json=EXCLUDED.qa_json,manifest_json=EXCLUDED.manifest_json`,[id,manifest.job_id,manifest.profile_version,manifest.template_version,manifest.model,manifest.pdf_path,manifest.html_path,manifest.sha256,manifest.qa,manifest]);
      await observe(repository,{event:'CV_PDF_VISUAL_APPROVED',entity_type:'cv',entity_id:id,message:manifest.application_policy_blocker?'Document QA passed; employer policy blocks application':'Real PDF visual QA passed',pages:manifest.qa.pdf.page_count,application_eligible:manifest.application_eligible,application_policy_blocker:manifest.application_policy_blocker??null});
      return {generated:1,cv_id:id,pdf_qa_pass:true,application_eligible:manifest.application_eligible,application_policy_blocker:manifest.application_policy_blocker??null};
    },{trigger:'actual_pdf_visual_review',mode:'REAL'});
    console.log(JSON.stringify({cv_id:id,status:manifest.status,pages:manifest.qa.pdf.page_count,registered_approved_artifact:true,application_eligible:manifest.application_eligible,application_policy_blocker:manifest.application_policy_blocker??null,pdf_path:manifest.pdf_path}));
  }
}finally{await repository.close();}
