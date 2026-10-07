import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,open,writeFile,unlink,readFile} from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
const execute=promisify(execFile),root=process.cwd(),directory=path.resolve('data/runtime');
const services=[
 ...(process.env.OLLAMA_PROVIDER==='lmstudio'?[{name:'lmstudio',entry:'scripts/resident-lmstudio.mjs'}]:[]),
 {name:'postgres',entry:'scripts/local-postgres.mjs',url:'tcp:55432'},
 {name:'core',entry:'services/core/server.mjs',url:'http://127.0.0.1:3000/health'},
 {name:'browser',entry:'services/browser-service/server.mjs',url:'http://127.0.0.1:3001/health'},
 {name:'dashboard',entry:'services/dashboard/server.mjs',url:'http://127.0.0.1:3020/health'},
 {name:'n8n',entry:'scripts/local-n8n.mjs',url:'http://127.0.0.1:5678/healthz'},
 {name:'worker',entry:'scripts/continuous-worker.mjs'},
 {name:'telegram',entry:'scripts/telegram-poll.mjs'},
];
async function pids(entry){
 const escaped=entry.replaceAll("'","''");
 const {stdout}=await execute('powershell.exe',['-NoProfile','-Command',`@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine.Replace('\\','/') -match [regex]::Escape('${escaped}') } | ForEach-Object { $_.ProcessId }) | ConvertTo-Json -Compress`],{windowsHide:true});
 const parsed=JSON.parse(stdout.trim()||'[]');return Array.isArray(parsed)?parsed:[parsed];
}
async function healthy(service,ids){
 if(!service.url)return ids.length===1;
 if(service.name==='postgres'){const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:2000,query_timeout:2000});try{await client.connect();await client.query('SELECT 1');return true;}catch{return false;}finally{await client.end().catch(()=>{});}}
 if(service.url.startsWith('tcp:')){
  const {createConnection}=await import('node:net');return new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port:Number(service.url.slice(4))});let done=false;const finish=ok=>{if(done)return;done=true;socket.destroy();resolve(ok);};socket.setTimeout(2000);socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.once('timeout',()=>finish(false));});
 }
 try{return(await fetch(service.url,{signal:AbortSignal.timeout(3000)})).ok;}catch{return false;}
}
async function launch(service){
 const stdout=await open(path.join(directory,service.name+'.supervised.out.log'),'a'),stderr=await open(path.join(directory,service.name+'.supervised.error.log'),'a');
 try{const child=spawn(process.execPath,['--env-file=.env',service.entry],{cwd:root,windowsHide:true,stdio:['ignore',stdout.fd,stderr.fd]});child.on('error',()=>{});return child.pid;}finally{await stdout.close();await stderr.close();}
}
await mkdir(directory,{recursive:true});const lockPath=path.join(directory,'supervisor.lock');
try{const previous=Number(await readFile(lockPath,'utf8'));if(Number.isInteger(previous)&&previous>0){try{process.kill(previous,0);throw new Error('SUPERVISOR_ALREADY_RUNNING');}catch(error){if(error.message==='SUPERVISOR_ALREADY_RUNNING')throw error;}}await unlink(lockPath);}catch(error){if(error.message==='SUPERVISOR_ALREADY_RUNNING')throw error;}
const lock=await open(lockPath,'wx');await lock.writeFile(String(process.pid));await lock.close();
let stopped=false;process.on('SIGINT',()=>stopped=true);process.on('SIGTERM',()=>stopped=true);
const attempts=new Map();
try{while(!stopped){const states=[];let databaseReady=false;
 for(const service of services){
  try{const pause=JSON.parse(await readFile(path.join(directory,'hardware-pause.json'),'utf8'));if(pause.paused&&['lmstudio','worker','browser','n8n','telegram'].includes(service.name)){states.push({name:service.name,state:pause.state??'PAUSED'});continue;}}catch{}
  try{const maintenance=JSON.parse(await readFile(path.join(directory,'maintenance.json'),'utf8'));if(maintenance.services?.includes(service.name)){states.push({name:service.name,state:'UPDATING'});continue;}}catch{}
  if(['core','dashboard','n8n','worker','telegram'].includes(service.name)&&!databaseReady){states.push({name:service.name,state:'WAITING_FOR_POSTGRES'});continue;}
  try{const ids=await pids(service.entry);const ok=await healthy(service,ids);if(service.name==='postgres')databaseReady=ok;
   if(ok){attempts.delete(service.name);states.push({name:service.name,state:'RUNNING',pids:ids});continue;}
   if(ids.length){states.push({name:service.name,state:'UNHEALTHY_EXISTING_PROCESS',pids:ids});continue;}
   const previous=attempts.get(service.name)??{count:0,last:0};
   if(previous.count>=5){states.push({name:service.name,state:'RESTART_LIMIT_REACHED'});continue;}
   if(Date.now()-previous.last<Math.min(120000,5000*2**previous.count)){states.push({name:service.name,state:'RESTART_BACKOFF'});continue;}
   const pid=await launch(service);attempts.set(service.name,{count:previous.count+1,last:Date.now()});states.push({name:service.name,state:'STARTING',pid});
  }catch{states.push({name:service.name,state:'SUPERVISION_CHECK_FAILED'});}
 }
 await writeFile(path.join(directory,'supervisor-status.json'),JSON.stringify({updated_at:new Date().toISOString(),pid:process.pid,services:states}),'utf8');
 await new Promise(resolve=>setTimeout(resolve,10000));
}}finally{await unlink(lockPath).catch(()=>{});}
