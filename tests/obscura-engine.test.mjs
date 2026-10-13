import test from 'node:test';import assert from 'node:assert/strict';
import {connectApplicationBrowser,setApplicationInputFiles,newApplicationContext} from '../services/browser-service/browser-engine.mjs';
test('application browser rejects remote CDP endpoints',async()=>{
 for(const endpoint of ['http://example.com:9222','http://user:pass@127.0.0.1:9422'])await assert.rejects(connectApplicationBrowser({endpoint}),/LOCAL_OBSCURA_ENDPOINT_REQUIRED/);
});
test('native Obscura fills and uploads with actual File bytes and keeps contexts isolated',{skip:process.env.TEST_OBSCURA!=='true'},async()=>{
 const browser=await connectApplicationBrowser({verifyInterception:false});
 try{
  const c=await newApplicationContext(browser),other=await newApplicationContext(browser);const page=await c.newPage();
  await page.setContent('<html><body><input id="name"><input id="file" type="file"><p id="received"></p><script>document.querySelector("#file").onchange=async()=>document.querySelector("#received").textContent=await document.querySelector("#file").files[0].text()</script></body></html>');
  await page.locator('#name').fill('Test candidate');
  await setApplicationInputFiles(page,'#file',process.cwd()+'/package.json');
  await page.waitForFunction(()=>document.querySelector('#received').textContent.includes('jobhunter-n8n'));
  assert.equal(await page.locator('#name').inputValue(),'Test candidate');
  assert.equal(await page.evaluate(()=>{'use strict';const f=document.createElement('iframe'),tokens=f.sandbox;f.sandbox='allow-scripts';return f.getAttribute('sandbox')==='allow-scripts'&&tokens===f.sandbox;}),true);
  await c.addCookies([{name:'isolation_probe',value:'one',domain:'example.com',path:'/'}]);
  assert.equal((await other.cookies()).some(c=>c.name==='isolation_probe'),false);
  await page.screenshot({path:'data/acceptance/obscura-engine-test.png'});
  await c.close();await other.close();
 }finally{await browser.close();}
});
