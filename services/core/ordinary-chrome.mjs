// Compatibility entry point for existing callers; all application browsing is Obscura.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {connectApplicationBrowser,newApplicationContext} from '../browser-service/browser-engine.mjs';
import {acquireProfileLock} from './profile-lock.mjs';
export async function ordinaryChromeContext({directory}){
 await mkdir(directory,{recursive:true});
 const release=await acquireProfileLock(path.join(directory,'browser-owner.lock'));
 let browser;
 try{
  browser=await connectApplicationBrowser();
  let storageState;try{storageState=JSON.parse(await readFile(path.join(directory,'obscura-state.json'),'utf8'));}catch{}
  const context=await newApplicationContext(browser,{storageState});const close=context.close.bind(context);
  context.close=async()=>{try{await writeFile(path.join(directory,'obscura-state.json'),JSON.stringify(await context.storageState()),{mode:0o600});await close();}finally{await browser.close();await release();}};
  return context;
 }catch(error){await browser?.close().catch(()=>{});await release();throw error;}
}
