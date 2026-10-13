import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';
import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {connectApplicationBrowser,newApplicationContext,setApplicationInputFiles} from '../services/browser-service/browser-engine.mjs';
const executable=path.resolve(process.argv[2]??'data/vendor/obscura-v0.2.4/target/release/obscura.exe');
const requests=[];const server=http.createServer(async(req,res)=>{let bytes=0;for await(const chunk of req)bytes+=chunk.length;requests.push({method:req.method,url:req.url,bytes});res.writeHead(200,{'content-type':'text/html'});res.end('<html><body>ORIGINAL_RESPONSE</body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const child=spawn(executable,['serve','--host','127.0.0.1','--port','9444','--allow-private-network','--allow-file-access','--max-connections','2'],{windowsHide:true,stdio:'ignore'});
let browser;const result={started_at:new Date().toISOString(),executable,tests:[],real_applications:0};
try{
 for(let i=0;i<100;i++){try{browser=await connectApplicationBrowser({endpoint:'http://127.0.0.1:9444',verifyInterception:false});break;}catch{await new Promise(resolve=>setTimeout(resolve,200));}}
 if(!browser)throw Error('TEST_ENGINE_NOT_READY');
 let context=await newApplicationContext(browser),page=await context.newPage();
 await page.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<html><body>INTERCEPTED_RESPONSE</body></html>'}));
 await page.goto(base+'/fulfill');assert.equal((await page.locator('body').textContent()).trim(),'INTERCEPTED_RESPONSE');assert.equal(requests.length,0);result.tests.push('main_document_fulfill_before_transport');await context.close();
 context=await newApplicationContext(browser);page=await context.newPage();await page.route('**/*',route=>route.abort());
 await assert.rejects(page.goto(base+'/blocked',{timeout:5000}));assert.equal(requests.length,0);result.tests.push('main_document_abort_zero_socket_requests');await context.close();
 context=await newApplicationContext(browser);await context.route('**/*',route=>route.continue());page=await context.newPage();await page.goto(base+'/continued');assert.equal((await page.locator('body').textContent()).trim(),'ORIGINAL_RESPONSE');assert.equal(requests.filter(r=>r.url==='/continued').length,1);result.tests.push('main_document_continue_once');await context.close();
 const pdf=Buffer.from([37,80,68,70,45,255,0,128,10,13]);const file='data/acceptance/network-fixture.pdf';await fs.writeFile(file,pdf);const digest=value=>createHash('sha256').update(value).digest('hex');
 const binary=Buffer.from([0,255,128,10,13,254]);let uploadObserved=false,deniedWrites=0;const observedRequests=[];result.observed_requests=observedRequests;
 context=await newApplicationContext(browser);
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());observedRequests.push({url:url.pathname,method:request.method(),body_bytes:request.postDataBuffer()?.length??0});
  if(url.pathname==='/upload'){
   assert.equal(request.method(),'POST');const body=request.postDataBuffer();assert.ok(Buffer.isBuffer(body));assert.ok(body.includes(pdf));uploadObserved=true;
   return route.fulfill({status:200,contentType:'application/json',body:'{"accepted":true}'});
  }
  if(url.pathname==='/binary')return route.fulfill({status:200,contentType:'application/octet-stream',body:binary});
  if(request.method()==='POST'){deniedWrites++;return route.abort();}
  return route.fulfill({status:200,contentType:'text/html',body:'<html><body><input id="file" type="file"><p id="status">waiting</p><script>document.body.dataset.scriptRan="yes";document.querySelector("#file").onchange=()=>{document.querySelector("#status").textContent="change-fired";const x=new XMLHttpRequest(),f=new FormData();f.append("resume",document.querySelector("#file").files[0]);x.onreadystatechange=()=>{if(x.readyState===4)document.querySelector("#status").textContent=x.responseText;};x.open("POST","/upload");x.send(f);};</script></body></html>'});
 });
 page=await context.newPage();await page.goto(base+'/fixture');result.before_upload=await page.evaluate(()=>({script:document.body.dataset.scriptRan,handler:typeof document.querySelector('#file').onchange}));await setApplicationInputFiles(page,'#file',path.resolve(file));
 result.after_upload=await page.locator('#status').textContent();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('accepted'),{},{timeout:10000});assert.equal(uploadObserved,true);result.tests.push('xhr_multipart_preserves_pdf_bytes');
 const fetched=await page.evaluate(async()=>Array.from(new Uint8Array(await(await fetch('/binary')).arrayBuffer())));assert.equal(digest(Buffer.from(fetched)),digest(binary));result.tests.push('binary_fulfill_bytes');
 await page.evaluate(async()=>{try{await fetch('/forbidden-submit',{method:'POST',body:'synthetic-only'});}catch{}});
 assert.equal(deniedWrites,1);assert.equal(requests.filter(r=>r.method==='POST').length,0);result.tests.push('javascript_post_abort_zero_socket_requests');
 await context.close();result.pass=true;
}catch(error){result.pass=false;result.error=error.message;process.exitCode=1;}
finally{await browser?.close().catch(()=>{});child.kill();await new Promise(resolve=>server.close(resolve));await fs.writeFile('data/acceptance/obscura-network-contract.json',JSON.stringify({...result,server_requests:requests},null,2));console.log(JSON.stringify(result));}
