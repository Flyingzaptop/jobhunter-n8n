import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const execute=promisify(execFile);
export async function localModelBusy(model){
 if(process.env.OLLAMA_PROVIDER!=='lmstudio')return false;
 try{const binary=process.env.USERPROFILE+'/.lmstudio/bin/lms.exe';const {stdout}=await execute(binary,['ps','--json'],{windowsHide:true,timeout:10000,maxBuffer:1000000});
  const instance=JSON.parse(stdout).find(item=>item.identifier===model);
  return !instance||instance.status==='generating'||Number(instance.queued)>0;
 }catch{return true;}
}
