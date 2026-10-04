import {spawn} from 'node:child_process';import {mkdir,open,readFile,unlink} from 'node:fs/promises';import path from 'node:path';
import {chromium} from 'playwright';
export async function ordinaryChromeContext({directory,port,minimized=true}){
 await mkdir(directory,{recursive:true});
 const lockPath=path.join(directory,'browser-owner.lock'),started=Date.now();let acquired=false;
 while(!acquired){try{const lock=await open(lockPath,'wx');await lock.writeFile(String(process.pid));await lock.close();acquired=true;}catch(error){if(error.code!=='EEXIST')throw error;let alive=false;try{const pid=Number(await readFile(lockPath,'utf8'));if(Number.isInteger(pid)&&pid>0){process.kill(pid,0);alive=true;}}catch{}if(!alive){await unlink(lockPath).catch(()=>{});continue;}if(Date.now()-started>60000)throw new Error('ORDINARY_CHROME_PROFILE_BUSY');await new Promise(resolve=>setTimeout(resolve,250));}}
 const release=()=>unlink(lockPath).catch(()=>{});
 for(let i=0;i<40;i++){let busy=false;try{busy=(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(250)})).ok;}catch{}if(!busy)break;if(i===39){await release();throw new Error('ORDINARY_CHROME_PROFILE_BUSY');}await new Promise(resolve=>setTimeout(resolve,250));}
 const executable=path.join(process.env.ProgramFiles??'C:/Program Files','Google/Chrome/Application/chrome.exe');
 const child=spawn(executable,['--user-data-dir='+path.resolve(directory),'--remote-debugging-port='+port,'--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check',...(minimized?['--start-minimized']:[]),'about:blank'],{windowsHide:true,stdio:'ignore'});let launchError;
 child.on('error',error=>launchError=error);
 try{
  for(let i=0;i<80;i++){
   if(launchError)throw new Error('ORDINARY_CHROME_START_FAILED');
   try{const r=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)});if(r.ok)break;}catch{}
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:10000});
  const context=browser.contexts()[0];
  const close=context.close.bind(context);
  context.close=async()=>{try{const session=await browser.newBrowserCDPSession();await session.send('Browser.close');}catch{await close().catch(()=>{});}finally{await browser.close().catch(()=>{});
    for(let i=0;i<20;i++){try{await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(200)});}catch{break;}await new Promise(resolve=>setTimeout(resolve,100));}
    await release();
  }};
  return context;
 }catch(error){child.kill();await release();throw error;}
}
