import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import YAML from 'yaml';
import {cvIdentityQa} from './cv-v2.mjs';
import {PROMPT_VERSION} from './fit.mjs';
import {RELEVANCE_VERSION,relevanceInputHash,fitInputHash} from './relevance-queue.mjs';
import {verifyCurrentCvEvidence} from './cv-evidence.mjs';
import {atsAdapterFor} from '../browser-service/ats-adapters.mjs';
import {boardForUrl} from './board-profiles.mjs';
import {CV_V2_VERSION} from './cv-v2.mjs';
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const actualJob=job=>{try{const url=new URL(job.canonical_url);return url.protocol==='https:'&&!/(?:^|\.)(?:localhost|invalid|example\.com)$/.test(url.hostname)&&job.metadata?.test_fixture!==true&&job.metadata?.mode!=='MOCK';}catch{return false;}};
export async function productionGateStatus({repository,profile}){
 const profileHash=sha(profile),identity=cvIdentityQa(profile),model=process.env.LLM_FAST_MODEL??'qwen3.5:4b';
 const policy=YAML.parse(await readFile('config/search_policy.yaml','utf8'));
 const jobs=(await repository.listCanonicalJobs()).filter(actualJob),byId=new Map(jobs.map(j=>[j.job_id,j]));
 const queueRows=(await repository.pool.query('SELECT job_id,status,input_hash,relevance_version FROM relevance_queue')).rows;
 const queue=[...queueRows.reduce((m,r)=>m.set(r.status,(m.get(r.status)??0)+1),new Map())].map(([status,count])=>({status,count}));
 const covered=new Set(queueRows.filter(r=>byId.has(r.job_id)&&r.relevance_version===RELEVANCE_VERSION&&r.input_hash===relevanceInputHash(byId.get(r.job_id))).map(r=>r.job_id)).size;
 const receipts=(await repository.pool.query("SELECT f.* FROM fit_batch_receipts f JOIN operation_runs r ON r.run_id=f.run_id WHERE r.mode='REAL' AND f.profile_hash=$1 AND f.policy_hash=$2 AND f.prompt_version=$3 AND f.model=$4",[profileHash,sha(policy),PROMPT_VERSION,model])).rows;
 const batch=new Set(receipts.filter(f=>byId.has(f.job_id)&&f.fit_input_hash===fitInputHash({job:byId.get(f.job_id),profile,policy,model})).map(f=>f.job_id)).size;
 const latest=(await repository.pool.query('SELECT DISTINCT ON(job_id) job_id,analysis_json FROM job_analysis ORDER BY job_id,created_at DESC')).rows;
 const analyses=new Map(latest.map(r=>[r.job_id,r.analysis_json]));
 const candidates=(await repository.pool.query('SELECT * FROM cv_versions WHERE profile_version=$1',[profileHash])).rows;
 const cvs=[];for(const cv of candidates){const job=byId.get(cv.job_id);if(job&&cv.template_version===CV_V2_VERSION&&cv.qa_json?.tailoring?.pass===true&&(await verifyCurrentCvEvidence({cv,job,profile,analysis:analyses.get(cv.job_id)})).pass)cvs.push(cv);}
 const validCvs=new Map(cvs.map(c=>[c.cv_id,c]));
 const rehearsals=(await repository.pool.query("SELECT * FROM applications WHERE candidate_profile_id=$1 AND dry_run=true AND status='READY_TO_SUBMIT'",[profile.profile_id])).rows.filter(a=>{
  const state=a.last_state??{},review=state.final_review??{},job=byId.get(a.job_id),cv=validCvs.get(a.cv_id);
  return job&&cv&&state.preparation_only===true&&state.profile_hash===profileHash&&state.job_content_hash===job.content_hash&&state.cv_sha256===cv.sha256&&review.pass===true&&review.cv_sha256===cv.sha256&&review.form_fingerprint===state.page_fingerprint&&Date.parse(review.observed_at)>Date.now()-15*60000&&job.availability_status==='OPEN'&&!cv.manifest_json?.application_policy_blocker;
 });
 const adapters=[...new Set(rehearsals.map(a=>atsAdapterFor(byId.get(a.job_id).canonical_url)).filter(a=>a!=='generic'))];
 const preparedBoards=[...new Set(rehearsals.map(a=>boardForUrl(byId.get(a.job_id).canonical_url)).filter(Boolean))];
 let calibration={pass:false},telegram={pass:false};
 try{calibration=JSON.parse(await readFile('tests/results/fit-calibration-gate.json','utf8'));}catch{}
 try{telegram=JSON.parse(await readFile('data/telegram/delivery-proof.json','utf8'));}catch{}
 const labelRows=(await repository.pool.query("SELECT job_id,source_quote,source_url,label_json FROM fit_calibration_labels WHERE label_json->>'profile_hash'=$1 AND review_status IN ('AGENT_REVIEWED_USER_PENDING','USER_REVIEWED')",[profileHash])).rows;
 const labels=labelRows.filter(r=>byId.has(r.job_id)&&byId.get(r.job_id).canonical_url===r.source_url&&byId.get(r.job_id).description_text?.includes(r.source_quote)).length;
 const answerRows=(await repository.pool.query("SELECT a.job_id FROM application_answer_receipts r JOIN applications a USING(application_id) WHERE a.candidate_profile_id=$1 AND r.source='USER_DASHBOARD' AND r.dispatch_status='COMPLETED'",[profile.profile_id])).rows;
 const dashboardAnswers=answerRows.filter(r=>byId.has(r.job_id)).length;
 const checks=[
  {id:'identity',pass:identity.pass,evidence:{missing:identity.missing}},
  {id:'cheap_relevance_queue',pass:jobs.length>0&&covered===jobs.length,evidence:{statuses:queue,current_covered_jobs:covered,total_real_jobs:jobs.length,version:RELEVANCE_VERSION}},
  {id:'hundreds_actual_fit',label:'Actual fit validation sample',pass:batch>=20,evidence:{unique_jobs:batch,required:20,prompt_version:PROMPT_VERSION,acceptance_contract:'USER_APPROVED_AUTONOMOUS_RUN'}},
  {id:'reviewed_fit_calibration',pass:calibration.pass===true&&calibration.profile_hash===profileHash&&calibration.policy_hash===sha(policy)&&calibration.model===model&&calibration.prompt_version===PROMPT_VERSION&&labels>=20&&calibration.held_out_reviewed>=5,evidence:{reviewed_labels:labels,status:calibration.status??'PENDING'}},
  {id:'three_employer_ready_pdfs',pass:new Set(cvs.map(c=>c.job_id)).size>=3,evidence:{unique_jobs:new Set(cvs.map(c=>c.job_id)).size,required:3}},
  {id:'three_ats_final_review_stop',label:'Four source pipelines reached final review',pass:['praca','olx','pracuj','linkedin'].every(board=>preparedBoards.includes(board)),evidence:{adapters,boards:preparedBoards,required_boards:['praca','olx','pracuj','linkedin'],rehearsals:rehearsals.length}},
  {id:'actual_telegram_delivery',pass:telegram.pass===true&&!!telegram.message_id&&telegram.config_fingerprint===sha({token:process.env.TELEGRAM_BOT_TOKEN,chat_id:process.env.TELEGRAM_ALLOWED_CHAT_ID}),evidence:{configured:!!(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_ALLOWED_CHAT_ID),verified:telegram.pass===true}},
  {id:'dashboard_hitl',pass:dashboardAnswers>0,evidence:{completed_real_profile_answers:dashboardAnswers,status:dashboardAnswers?'VERIFIED':'LIVE_REAL_APPLICATION_VALIDATION_PENDING'}},
 ];
 const blockers=checks.filter(c=>!c.pass).map(c=>c.id);
 return {as_of:new Date().toISOString(),status:blockers.length?'PARTIAL':'PASS',pass:blockers.length===0,checks,blockers,real_submit_enabled:false,auto_apply_enabled:false,profile_hash:profileHash};
}
