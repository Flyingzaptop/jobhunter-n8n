import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {hardwarePaused} from '../services/core/hardware-pause.mjs';
const execute=promisify(execFile);
const binary=path.join(process.env.USERPROFILE,'.lmstudio','bin','lms.exe');
const identifier=process.env.LLM_STRONG_MODEL??'jobhunter-gemma4';
const modelKey=process.env.LM_STUDIO_MODEL_KEY??'gemma4-26b-a4b-qat-uncensored-hauhaucs-balanced-mtp';
const context=Number(process.env.LM_STUDIO_CONTEXT_LENGTH??32768);
if(process.env.OLLAMA_PROVIDER!=='lmstudio')throw new Error('LOCAL_LMSTUDIO_PROVIDER_REQUIRED');
if(!Number.isInteger(context)||context<1024)throw new Error('INVALID_MODEL_CONTEXT');
async function restore(){
 if(await hardwarePaused())return;
 const {stdout}=await execute(binary,['ps','--json'],{windowsHide:true,timeout:30000});
 const loaded=JSON.parse(stdout);
 await execute(binary,['server','start','--port','1234','--bind','127.0.0.1'],{windowsHide:true,timeout:30000});
 if(!loaded.some(model=>model.identifier===identifier)){
  await execute(binary,['load',modelKey,'--identifier',identifier,'--context-length',String(context),'--parallel','1','--yes'],{windowsHide:true,timeout:600000,maxBuffer:8*1024*1024});
 }
 console.log(JSON.stringify({event:'LOCAL_MODEL_RESIDENT',identifier}));
}
await restore();
// Serial recovery checks never unload a resident or progressing model.
for(;;){
 await new Promise(resolve=>setTimeout(resolve,60000));
 if(await hardwarePaused())continue;
 try{const response=await fetch('http://127.0.0.1:1234/v1/models',{signal:AbortSignal.timeout(10000)});const models=await response.json();if(!response.ok||!models.data?.some(model=>model.id===identifier))await restore();}
 catch{await restore();}
}
