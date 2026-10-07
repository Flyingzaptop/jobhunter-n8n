// One-shot deployment helper. Invoked independently through WMI, never scheduled.
import {Repository} from '../services/core/repository.mjs';
import {localModelBusy} from '../services/core/model-busy.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
const execute=promisify(execFile),repository=new Repository();
let token;
const status=state=>writeFile('data/runtime/cv-upgrade-status.json',JSON.stringify({state,at:new Date().toISOString(),pid:process.pid}));
try{
 const active=(await repository.pool.query("SELECT run_id FROM operation_runs WHERE stage=4 AND status='RUNNING' AND heartbeat_at>now()-interval '5 minutes'")).rows.map(r=>r.run_id);
 token=(await repository.pool.query("UPDATE runtime_control SET paused=true,updated_at=date_trunc('milliseconds',clock_timestamp()) WHERE id=true RETURNING updated_at")).rows[0].updated_at;
 await status('WAITING_FOR_CURRENT_CV');
 while(true){
  const remaining=Number((await repository.pool.query("SELECT count(*) FROM operation_runs WHERE run_id=ANY($1::uuid[]) AND status='RUNNING'",[active])).rows[0].count);
  if(!remaining&&!await localModelBusy('jobhunter-gemma4'))break;
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 await status('RESTARTING_IDLE_SERVICES');
 for(const entry of ['scripts/continuous-worker.mjs','services/core/server.mjs','services/dashboard/server.mjs']){
  const pattern='\\s--env-file=\\.env\\s+'+entry.replaceAll('.','\\.')+'(?:\\s|$)';
  await execute('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match '${pattern}' } | ForEach-Object { Stop-Process -Id $_.ProcessId }`],{windowsHide:true});
 }
 // Existing independent supervisor restores these processes using the new code.
 await repository.pool.query('UPDATE runtime_control SET paused=false,updated_at=now() WHERE id=true AND updated_at=$1',[token]);token=null;
 await status('FAST_CV_DEPLOYED');
}catch(error){await status('UPGRADE_FAILED');throw error;}
finally{if(token)await repository.pool.query('UPDATE runtime_control SET paused=false,updated_at=now() WHERE id=true AND updated_at=$1',[token]);await repository.pool.end();}
