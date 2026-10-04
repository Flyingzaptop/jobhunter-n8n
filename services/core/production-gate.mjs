import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cvIdentityQa} from './cv-v2.mjs';
import {PROMPT_VERSION} from './fit.mjs';
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function productionGateStatus({repository,profile}){
 const profileHash=sha(profile),identity=cvIdentityQa(profile);
 const queue=(await repository.pool.query('SELECT status,count(*)::int count FROM relevance_queue GROUP BY status')).rows;
 const batch=(await repository.pool.query('SELECT count(DISTINCT job_id)::int count FROM fit_batch_receipts WHERE profile_hash=$1 AND prompt_version=$2 AND model=$3',[profileHash,PROMPT_VERSION,process.env.LLM_FAST_MODEL??'qwen3.5:4b'])).rows[0].count;
 const cvs=(await repository.pool.query(`SELECT cv_id,job_id,qa_json,manifest_json FROM cv_versions WHERE profile_version=$1 AND qa_json->>'pass'='true' AND manifest_json->>'application_eligible'='true' AND NOT(manifest_json ? 'application_policy_blocker')`,[profileHash])).rows;
 const rehearsals=(await repository.pool.query("SELECT a.application_id,j.canonical_url,a.last_state FROM applications a JOIN jobs j USING(job_id) WHERE a.candidate_profile_id=$1 AND a.dry_run=true AND a.status='READY_TO_SUBMIT' AND a.last_state->'final_review'->>'pass'='true'",[profile.profile_id])).rows;
 const adapters=[...new Set(rehearsals.map(r=>{try{const h=new URL(r.canonical_url).hostname;return h.includes('greenhouse')?'greenhouse':h.includes('teamtailor')?'teamtailor':h.includes('lever')?'lever':h.includes('ashby')?'ashby':h.includes('smartrecruiters')?'smartrecruiters':'other';}catch{return 'unknown';}}))];
 let calibration={pass:false},telegram={pass:false};
 try{calibration=JSON.parse(await readFile('tests/results/fit-calibration-gate.json','utf8'));}catch{}
 try{telegram=JSON.parse(await readFile('data/telegram/delivery-proof.json','utf8'));}catch{}
 const labels=(await repository.pool.query("SELECT count(*)::int count FROM fit_calibration_labels WHERE label_json->>'profile_hash'=$1 AND review_status IN ('AGENT_REVIEWED_USER_PENDING','USER_REVIEWED')",[profileHash])).rows[0].count;
 const dashboardAnswers=(await repository.pool.query("SELECT count(*)::int count FROM application_answer_receipts r JOIN applications a USING(application_id) WHERE a.candidate_profile_id=$1 AND r.source='USER_DASHBOARD' AND r.dispatch_status='COMPLETED'",[profile.profile_id])).rows[0].count;
 const checks=[
  {id:'identity',pass:identity.pass,evidence:{missing:identity.missing}},
  {id:'cheap_relevance_queue',pass:queue.reduce((n,r)=>n+r.count,0)>0,evidence:{statuses:queue}},
  {id:'hundreds_actual_fit',pass:batch>=200,evidence:{unique_jobs:batch,required:200}},
  {id:'reviewed_fit_calibration',pass:calibration.pass===true&&calibration.profile_hash===profileHash&&labels>=20,evidence:{reviewed_labels:labels,status:calibration.status??'PENDING'}},
  {id:'three_employer_ready_pdfs',pass:new Set(cvs.map(c=>c.job_id)).size>=3,evidence:{unique_jobs:new Set(cvs.map(c=>c.job_id)).size,required:3}},
  {id:'three_ats_final_review_stop',pass:adapters.includes('greenhouse')&&adapters.includes('teamtailor')&&adapters.length>=3,evidence:{adapters,rehearsals:rehearsals.length}},
  {id:'actual_telegram_delivery',pass:telegram.pass===true&&!!telegram.message_id&&telegram.config_fingerprint===sha({token:process.env.TELEGRAM_BOT_TOKEN,chat_id:process.env.TELEGRAM_ALLOWED_CHAT_ID}),evidence:{configured:!!(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_ALLOWED_CHAT_ID),verified:telegram.pass===true}},
  {id:'dashboard_hitl',pass:dashboardAnswers>0,evidence:{completed_real_profile_answers:dashboardAnswers,status:dashboardAnswers?'VERIFIED':'LIVE_REAL_APPLICATION_VALIDATION_PENDING'}},
 ];
 const blockers=checks.filter(c=>!c.pass).map(c=>c.id);
 return {as_of:new Date().toISOString(),status:blockers.length?'PARTIAL':'PASS',pass:blockers.length===0,checks,blockers,real_submit_enabled:false,auto_apply_enabled:false,profile_hash:profileHash};
}
