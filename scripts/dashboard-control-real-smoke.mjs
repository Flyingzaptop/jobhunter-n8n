import {mkdir,writeFile} from 'node:fs/promises';
import {Repository} from '../services/core/repository.mjs';
if(process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT!=='false')throw new Error('Readiness dry-run required');
const base='http://127.0.0.1:3020',repository=new Repository();
let cookie,csrf;
const report={scope:'REAL_WORLD_TESTS',started_at:new Date().toISOString(),stage:2,real_employer_submissions:0,status:'RUNNING'};
const save=async()=>{await mkdir('tests/results',{recursive:true});await writeFile('tests/results/dashboard-control-real-v2.json',JSON.stringify(report,null,2));};
const call=async(path,body)=>{
 const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',origin:base,...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{})},body:body?JSON.stringify(body):undefined});
 const value=await response.json();if(!response.ok)throw new Error(`CONTROL_SMOKE_HTTP_${response.status}`);return {response,value};
};
try{
 const login=await call('/api/auth/login',{password:process.env.DASHBOARD_PASSWORD});cookie=login.response.headers.get('set-cookie').split(';')[0];csrf=login.value.data.csrf_token;
 const overview=(await call('/api/overview')).value.data;
 if(overview.mode.paused)throw new Error('Existing operator pause must remain respected');
 if(!overview.mode.dry_run||overview.mode.real_submit_enabled)throw new Error('Unsafe actual runtime mode');
 const operation=(await call('/api/control/trigger',{stage:2})).value.data;report.operation_id=operation.run_id;await save();
 for(let iteration=0;iteration<90;iteration++){
  const row=(await repository.pool.query('SELECT operation_id,stage,status,requested_at,started_at,completed_at,error_code FROM dashboard_operations WHERE operation_id=$1',[operation.run_id])).rows[0];
  report.operation=row;await save();
  if(['SUCCEEDED','FAILED','BLOCKED'].includes(row.status))break;
  await new Promise(resolve=>setTimeout(resolve,10000));
 }
 report.operation_runs=(await repository.pool.query('SELECT run_id,stage,mode,status,processed_count,success_count,failure_count,message FROM operation_runs WHERE started_at>=$1 ORDER BY started_at',[report.operation.requested_at])).rows;
 report.status=report.operation.status==='SUCCEEDED'&&report.operation_runs.some(r=>r.stage===2&&r.mode==='REAL')?'PASS':'PARTIAL';
 report.completed_at=new Date().toISOString();await save();console.log(JSON.stringify(report));
}finally{if(cookie)await call('/api/auth/logout',{}).catch(()=>{});await repository.close();}
