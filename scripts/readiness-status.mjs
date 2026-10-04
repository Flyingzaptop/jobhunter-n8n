import {Repository} from '../services/core/repository.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const repository=new Repository();
try{
 const queries={
  jobs:'SELECT count(*)::int total, count(*) FILTER (WHERE availability_status=\'OPEN\')::int verified_or_observed_open FROM jobs',
  analyses:'SELECT decision,count(*)::int records FROM job_analysis GROUP BY decision ORDER BY decision',
  latest_job_decisions:'SELECT decision,count(*)::int unique_jobs FROM (SELECT DISTINCT ON (job_id) job_id,decision FROM job_analysis ORDER BY job_id,created_at DESC) a GROUP BY decision ORDER BY decision',
  cv_drafts:'SELECT status,count(*)::int records FROM cv_drafts GROUP BY status ORDER BY status',
  applications:'SELECT status,count(*)::int records FROM applications GROUP BY status ORDER BY status',
  latest_runs:'SELECT run_id,stage,mode,status,processed_count,success_count,failure_count,message FROM operation_runs ORDER BY started_at DESC LIMIT 12',
  dashboard_operations:'SELECT operation_id,stage,status,requested_at,completed_at,error_code FROM dashboard_operations ORDER BY requested_at DESC LIMIT 5',
  control_errors:"SELECT payload_json->>'message' AS message FROM events WHERE event_type='DASHBOARD_TRIGGER_FAILED' ORDER BY created_at DESC LIMIT 3",
 };
 const report={as_of:new Date().toISOString(),scope:'REAL_WORLD_TESTS',dry_run:process.env.DRY_RUN==='true',allow_real_submit:process.env.ALLOW_REAL_SUBMIT==='true'};
 for(const [key,sql] of Object.entries(queries))report[key]=(await repository.pool.query(sql)).rows;
 try{report.n8n_executions=(await repository.pool.query('SELECT id,status,"workflowId","startedAt","stoppedAt" FROM n8n.execution_entity WHERE "deletedAt" IS NULL ORDER BY id DESC LIMIT 5')).rows;}catch{report.n8n_executions=[];}
 try{report.n8n_workflow_destinations=(await repository.pool.query("SELECT id,nodes FROM n8n.workflow_entity WHERE id IN ('WF-01','WF-02','WF-03','WF-04','WF-05','WF-06')")).rows.map(row=>({id:row.id,urls:(typeof row.nodes==='string'?JSON.parse(row.nodes):row.nodes).filter(n=>n.type==='n8n-nodes-base.httpRequest').map(n=>n.parameters.url)}));}catch{report.n8n_workflow_destinations=[];}
 for(const [key,file] of Object.entries({market:'tests/results/market-discovery-v2.json',cv:'tests/results/cv-v2-real.json',ats:'tests/results/ats-real-v2.json',dashboard:'data/dashboard-v2/ui-smoke.json'})){
  try{const value=JSON.parse(await readFile(file,'utf8'));report[key]={status:value.status,started_at:value.started_at,completed_at:value.completed_at,samples:value.samples?.length,real_employer_submissions:value.real_employer_submissions};}catch{report[key]={status:'EVIDENCE_UNAVAILABLE'};}
 }
 await mkdir('tests/results',{recursive:true});await writeFile('tests/results/readiness-status-v2.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await repository.close();}
