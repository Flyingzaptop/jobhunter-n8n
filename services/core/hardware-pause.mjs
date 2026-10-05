import {mkdir,writeFile,unlink,readFile} from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile),marker=path.resolve('data/runtime/hardware-pause.json');
export async function hardwarePaused(){try{return Boolean(JSON.parse(await readFile(marker,'utf8')).paused);}catch{return false;}}
export async function hardwarePause(repository,{execute=exec}={}){
 await mkdir(path.dirname(marker),{recursive:true});await writeFile(marker,JSON.stringify({paused:true,state:'PAUSED',at:new Date().toISOString()}));
 await repository.pool.query('UPDATE runtime_control SET paused=true,updated_at=now() WHERE id=true');
 const fit=(await repository.pool.query("SELECT job_id FROM relevance_queue WHERE status='RUNNING' ORDER BY claimed_at DESC LIMIT 1")).rows[0];
 const cv=(await repository.pool.query("SELECT w.entity_id FROM continuous_work w JOIN continuous_worker_status s ON s.owner_id=w.owner_id AND s.lane='model' WHERE w.lane='cv' AND w.status='RUNNING' LIMIT 1")).rows[0];
 const task=fit?{type:'FIT',job_id:fit.job_id}:cv?{type:'CV',job_id:cv.entity_id}:null;
 await repository.pool.query('UPDATE runtime_control SET resume_model_task=$1 WHERE id=true',[task]);
 const entries=['scripts/continuous-worker.mjs','services/browser-service/server.mjs','scripts/resident-lmstudio.mjs','scripts/local-n8n.mjs','scripts/telegram-poll.mjs'];
 for(const entry of entries){const pattern='\\s--env-file=\\.env\\s+'+entry.replaceAll('.','\\.')+'(?:\\s|$)';await execute('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match '${pattern}' } | ForEach-Object { Stop-Process -Id $_.ProcessId }`],{windowsHide:true});}
 await repository.pool.query("UPDATE relevance_queue SET status='QUEUED',claimed_by=NULL,claimed_at=NULL WHERE status='RUNNING'");
 await repository.pool.query("UPDATE continuous_work SET status='RETRY',next_retry_at=now(),lease_until=NULL,outcome_code='HARDWARE_PAUSE_RESTART_REQUIRED' WHERE status='RUNNING'");
 await repository.pool.query("UPDATE operation_runs SET status='PAUSED',message='Hardware pause; unfinished task will restart',completed_at=now() WHERE status='RUNNING'");
 const identifier=process.env.LLM_STRONG_MODEL??'jobhunter-gemma4',binary=path.join(process.env.USERPROFILE,'.lmstudio','bin','lms.exe');
 const ps=JSON.parse((await execute(binary,['ps','--json'],{windowsHide:true,timeout:30000})).stdout);if(ps.some(m=>m.identifier===identifier))await execute(binary,['unload',identifier],{windowsHide:true,timeout:60000});
 const loaded=JSON.parse((await execute(binary,['ps','--json'],{windowsHide:true,timeout:30000})).stdout);if(loaded.some(m=>m.identifier===identifier))throw Error('MODEL_UNLOAD_NOT_CONFIRMED');
 await repository.event('system','runtime','HARDWARE_PAUSED',{model_unloaded:true,restart_task:task});return {paused:true,model_unloaded:true,restart_task:task};
}
export async function hardwareResume(repository,{execute=exec}={}){
 await writeFile(marker,JSON.stringify({paused:true,state:'RESUMING',at:new Date().toISOString()}));
 const identifier=process.env.LLM_STRONG_MODEL??'jobhunter-gemma4',binary=path.join(process.env.USERPROFILE,'.lmstudio','bin','lms.exe');
 await execute(binary,['server','start','--port','1234','--bind','127.0.0.1'],{windowsHide:true,timeout:30000});
 const loaded=JSON.parse((await execute(binary,['ps','--json'],{windowsHide:true,timeout:30000})).stdout);
 if(!loaded.some(m=>m.identifier===identifier))await execute(binary,['load',process.env.LM_STUDIO_MODEL_KEY??'gemma4-26b-a4b-qat-uncensored-hauhaucs-balanced-mtp','--identifier',identifier,'--context-length',String(process.env.LM_STUDIO_CONTEXT_LENGTH??32768),'--parallel','1','--yes'],{windowsHide:true,timeout:600000,maxBuffer:8*1024*1024});
 await repository.pool.query('UPDATE runtime_control SET paused=false,updated_at=now() WHERE id=true');await unlink(marker).catch(()=>{});await repository.event('system','runtime','HARDWARE_RESUMED',{});return {paused:false,model_loaded:true,unfinished_task_restarts:true};
}
