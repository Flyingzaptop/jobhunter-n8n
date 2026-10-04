import {spawn} from 'node:child_process';import {mkdir} from 'node:fs/promises';import path from 'node:path';
import {chromium} from 'playwright';
export async function ordinaryChromeContext({directory,port,minimized=true}){
 try{const response=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)});if(response.ok)throw new Error('ORDINARY_CHROME_PROFILE_BUSY');}catch(error){if(error.message==='ORDINARY_CHROME_PROFILE_BUSY')throw error;}
 await mkdir(directory,{recursive:true});
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
  }};
  return context;
 }catch(error){child.kill();throw error;}
}
