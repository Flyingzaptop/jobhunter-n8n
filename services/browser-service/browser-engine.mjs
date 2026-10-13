import {installObscuraDomCompatibility} from './obscura-dom-compatibility.mjs';
import {chromium} from 'playwright';
export const APPLICATION_BROWSER_ENGINE='obscura';
export async function verifyObscuraInterception(browser){
 const context=await browser.newContext();
 try{
  const page=await context.newPage();const marker='JOBHUNTER_NETWORK_OVERRIDE_CONTRACT';
  await page.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:`<html><body>${marker}</body></html>`}));
  await page.goto('https://example.com',{timeout:15000});
  if((await page.locator('body').textContent()).trim()!==marker)throw Error('OBSCURA_REQUEST_INTERCEPTION_NOT_VERIFIED');
 }finally{await context.close();}
}
export async function connectApplicationBrowser({endpoint=process.env.OBSCURA_CDP_URL??'http://127.0.0.1:9422',verifyInterception=true}={}){
 const url=new URL(endpoint);
 if(!['http:','ws:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password)throw Error('LOCAL_OBSCURA_ENDPOINT_REQUIRED');
 const browser=await chromium.connectOverCDP(endpoint,{timeout:20000});
 try{if(verifyInterception)await verifyObscuraInterception(browser);return browser;}
 catch(error){await browser.close();throw error;}
}
export async function setApplicationInputFiles(page,selector,files){
 const client=await page.context().newCDPSession(page);
 try{
  const {root}=await client.send('DOM.getDocument');
  const {nodeId}=await client.send('DOM.querySelector',{nodeId:root.nodeId,selector});
  if(!nodeId)throw Error('OBSERVED_FILE_INPUT_NOT_FOUND');
  await client.send('DOM.setFileInputFiles',{nodeId,files:Array.isArray(files)?files:[files]});
 }finally{await client.detach();}
}

export async function obscuraFrameElement(frame){
 const parent=frame.parentFrame();if(!parent)throw Error('TOP_FRAME_HAS_NO_OWNER');
 const owners=parent.locator('iframe,frame');
 const sources=await owners.evaluateAll(elements=>elements.map((e,index)=>({index,src:e.src})));
 const normalized=value=>{try{return new URL(value).href;}catch{return value;}};
 const exact=sources.filter(e=>normalized(e.src)===normalized(frame.url()));
 if(exact.length!==1)throw Error('OBSCURA_FRAME_OWNER_NOT_UNIQUE');
 const handle=await owners.nth(exact[0].index).elementHandle();
 if(!handle)throw Error('OBSCURA_FRAME_OWNER_NOT_FOUND');return handle;
}
export async function newApplicationContext(browser,options={}){
 const context=await browser.newContext(options);await context.addInitScript(installObscuraDomCompatibility);
 context.on('page',page=>{
  const wrap=frame=>{const original=frame.frameElement.bind(frame);frame.frameElement=async()=>{try{return await original();}catch(error){if(!/getFrameOwner/.test(error.message))throw error;return obscuraFrameElement(frame);}};};
  page.frames().forEach(wrap);page.on('frameattached',wrap);
 });
 return context;
}
