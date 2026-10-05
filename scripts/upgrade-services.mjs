import {Repository} from '../services/core/repository.mjs';
import {localModelBusy} from '../services/core/model-busy.mjs';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import path from 'node:path';
const execute=promisify(execFile),repository=new Repository(),directory=path.resolve('data/runtime');
const entries=['scripts/continuous-worker.mjs','services/core/server.mjs','services/browser-service/server.mjs','services/dashboard/server.mjs'];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let pauseToken,maintenance=false;
try{
 await mkdir(directory,{recursive:true});
 console.log(JSON.stringify({event:'UPGRADE_WAITING_FOR_MODEL_IDLE'}));
 while(!pauseToken){
  if(await localModelBusy(process.env.LLM_STRONG_MODEL??'jobhunter-gemma4')){await wait(5000);continue;}
  const row=(await repository.pool.query("UPDATE runtime_control SET paused=true,updated_at=clock_timestamp() WHERE id=true AND paused=false AND (NOT EXISTS(SELECT 1 FROM continuous_worker_status WHERE lane='model' AND state='RUNNING') OR (NOT EXISTS(SELECT 1 FROM relevance_queue WHERE status='RUNNING') AND NOT EXISTS(SELECT 1 FROM continuous_work WHERE status='RUNNING' AND lane='cv') AND NOT EXISTS(SELECT 1 FROM application_prose_drafts WHERE status='GENERATING'))) RETURNING updated_at::text AS token")).rows[0];
  if(row)pauseToken=row.token;else await wait(5000);
 }
 console.log(JSON.stringify({event:'UPGRADE_DRAINING_WORKERS'}));
 while((await repository.pool.query("SELECT 1 FROM continuous_worker_status WHERE state='RUNNING' AND (lane<>'model' OR EXISTS(SELECT 1 FROM relevance_queue WHERE status='RUNNING') OR EXISTS(SELECT 1 FROM continuous_work WHERE status='RUNNING' AND lane='cv') OR EXISTS(SELECT 1 FROM application_prose_drafts WHERE status='GENERATING')) LIMIT 1")).rowCount)await wait(2000);
 await writeFile(path.join(directory,'maintenance.json'),JSON.stringify({services:['worker','core','browser','dashboard'],started_at:new Date().toISOString()}),'utf8');maintenance=true;
 for(const entry of entries){
  const escaped=entry.replaceAll("'","''");
  await execute('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine.Replace('\\','/') -match [regex]::Escape('${escaped}') } | ForEach-Object { Stop-Process -Id $_.ProcessId }`],{windowsHide:true});
 }
 await unlink(path.join(directory,'maintenance.json'));maintenance=false;
 console.log(JSON.stringify({event:'UPGRADE_WAITING_FOR_SUPERVISOR_RESTART'}));
 for(let i=0;i<60;i++){
  const ok=await Promise.all([3000,3001,3020].map(async port=>{try{return(await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(2000)})).ok;}catch{return false;}}));
  if(ok.every(Boolean)){console.log(JSON.stringify({event:'UPGRADE_SERVICES_HEALTHY'}));break;}
  await wait(2000);if(i===59)throw new Error('UPGRADE_SERVICE_RECOVERY_FAILED');
 }
}finally{
 if(maintenance)await unlink(path.join(directory,'maintenance.json')).catch(()=>{});
 if(pauseToken)await repository.pool.query('UPDATE runtime_control SET paused=false,updated_at=now() WHERE id=true AND updated_at=$1::timestamptz',[pauseToken]);
 await repository.close();
}
