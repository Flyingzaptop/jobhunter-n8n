import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';

const signature = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const elapsed = (value, now) => now - new Date(value).getTime();

export function reconciliationActions({applications=[],questions=[],jobs=[],cvs=[],now=new Date(),staleAfterMs=60*60*1000}) {
  const time=now.getTime(),actions=[];
  const add=(entity_type,entity_id,code,recommendation,evidence={})=>actions.push({entity_type,entity_id,code,recommendation,evidence_hash:signature({code,...evidence}),automatic_submit:false});
  for(const application of applications){
    const evidence={status:application.status,updated_at:application.updated_at};
    if(application.status==='SUBMISSION_UNKNOWN'||application.status==='SUBMITTING')add('application',application.application_id,'SUBMISSION_RECONCILIATION_REQUIRED','Inspect confirmation evidence or request manual review; never replay Submit.',evidence);
    else if(['OPENING','FILLING','READY_TO_SUBMIT'].includes(application.status)&&elapsed(application.updated_at,time)>=staleAfterMs)add('application',application.application_id,'STUCK_APPLICATION','Inspect audit events and checkpoint before a bounded reversible recovery.',evidence);
    if(['NEEDS_USER','CAPTCHA_WAIT'].includes(application.status)&&!questions.some(q=>q.application_id===application.application_id&&q.answered_at===null))add('application',application.application_id,'MISSING_PENDING_QUESTION','Inspect notification failures and pending question correlation before resuming.',evidence);
  }
  for(const question of questions)if(question.answered_at===null&&elapsed(question.created_at,time)>=staleAfterMs)add('question',question.question_id,'STALE_PENDING_QUESTION','Notify the allowed user once or retain the safe paused state.',{created_at:question.created_at});
  for(const job of jobs)add('job',job.job_id,'JOB_AWAITING_ANALYSIS','Queue the normal validated analysis workflow; do not route to submission.',{content_hash:job.content_hash});
  for(const cv of cvs)if(elapsed(cv.created_at,time)>=staleAfterMs)add('cv',cv.cv_id,'UNREFERENCED_CV_REVIEW','Review retention or pending application; do not delete or start an application automatically.',{created_at:cv.created_at});
  return actions;
}

export async function reconcile(repository,{now=new Date(),staleAfterMs=60*60*1000,browser}={}) {
  const [applications,questions,jobs,cvs]=await Promise.all([
    repository.pool.query("SELECT * FROM applications WHERE status NOT IN ('SUBMITTED','SKIPPED','ALREADY_APPLIED')"),
    repository.pool.query('SELECT question_id,application_id,created_at,answered_at FROM application_questions WHERE answered_at IS NULL'),
    repository.pool.query("SELECT j.job_id,j.content_hash FROM jobs j WHERE j.availability_status<>'CLOSED' AND NOT EXISTS (SELECT 1 FROM job_analysis a WHERE a.job_id=j.job_id)"),
    repository.pool.query('SELECT c.cv_id,c.created_at,c.pdf_path,EXISTS (SELECT 1 FROM applications a WHERE a.cv_id=c.cv_id) AS referenced FROM cv_versions c')
  ]);
  const actions=reconciliationActions({applications:applications.rows,questions:questions.rows,jobs:jobs.rows,cvs:cvs.rows.filter(cv=>!cv.referenced),now,staleAfterMs});
  if(browser)for(const application of applications.rows){const sessionId=application.last_state?.browser_session_id;if(!sessionId||['SUBMITTING','SUBMISSION_UNKNOWN'].includes(application.status))continue;try{await browser.call(`/sessions/${sessionId}/snapshot`);}catch{actions.push({entity_type:'application',entity_id:application.application_id,code:'BROWSER_SESSION_EXPIRED',recommendation:application.status==='CAPTCHA_WAIT'?'Create a fresh human CAPTCHA request after recovery; never replay the old answer.':'Inspect the checkpoint and recover only reversible actions within the recovery limit.',evidence_hash:signature({sessionId,status:application.status}),automatic_submit:false});}}
  for(const cv of cvs.rows){try{await stat(cv.pdf_path);}catch{actions.push({entity_type:'cv',entity_id:cv.cv_id,code:'CV_ARTIFACT_MISSING',recommendation:'Regenerate through CV QA before any upload.',evidence_hash:signature({cv_id:cv.cv_id,pdf_missing:true}),automatic_submit:false});}}
  let newEvents=0;
  for(const action of actions){const existing=await repository.pool.query("SELECT 1 FROM events WHERE entity_type=$1 AND entity_id=$2 AND event_type='RECONCILIATION_REQUIRED' AND payload_json->>'evidence_hash'=$3 LIMIT 1",[action.entity_type,action.entity_id,action.evidence_hash]);if(!existing.rows.length){await repository.event(action.entity_type,action.entity_id,'RECONCILIATION_REQUIRED',action);newEvents++;}}
  return {checked_at:now.toISOString(),actions,new_events:newEvents,automatic_submissions:0};
}
