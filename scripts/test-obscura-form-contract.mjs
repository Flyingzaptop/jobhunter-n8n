import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {connectApplicationBrowser,newApplicationContext} from '../services/browser-service/browser-engine.mjs';
import {formFieldSemantics,mergeFieldSemantics} from '../services/browser-service/form-field-semantics.mjs';
import {missingRequiredFields} from '../services/browser-service/required-fields.mjs';
import {chooseLeverLocation} from '../services/browser-service/lever-location.mjs';
const binary=path.resolve('data/tools/obscura-v0.2.4-jobhunter/obscura.exe');
const child=spawn(binary,['serve','--host','127.0.0.1','--port','9445','--workers','1'],{windowsHide:true,stdio:'ignore'});
let browser;const result={at:new Date().toISOString(),engine:'obscura',real_applications:0,tests:[]};
try{
 for(let i=0;i<50&&!browser;i++){try{browser=await connectApplicationBrowser({endpoint:'http://127.0.0.1:9445',verifyInterception:false});}catch{await new Promise(r=>setTimeout(r,200));}}
 assert.ok(browser,'native test engine starts');const context=await newApplicationContext(browser);
 await context.route('**/*',route=>new URL(route.request().url()).pathname==='/searchLocations'?route.fulfill({status:403,body:'Forbidden'}):route.fulfill({status:200,contentType:'text/html',body:`<html><body><form id="application-form">
 <div class="application-question"><div class="application-label"><div class="text">Experience<span class="required">✱</span></div></div><textarea name="experience" required></textarea></div>
 <div class="application-question"><div class="application-label"><div class="text">Payment terms?<span class="required">✱</span></div></div><ul data-qa="checkboxes"><li><label><input type="checkbox" name="cards[x][field0]" value="Yes" required>Yes</label></li><li><label><input type="checkbox" name="cards[x][field0]" value="No" required>No</label></li></ul></div>
 <div class="application-question"><div class="application-label">Contact preference</div><select name="preference" required><option value="">Choose</option><option value="No">No</option></select></div>
 <input id="location-input" name="location"><input id="selected-location" type="hidden">
 </form><script>document.querySelector('#location-input').onkeydown=()=>{const x=new XMLHttpRequest();x.open('GET','/searchLocations');x.send();};</script></body></html>`}));
 const page=await context.newPage();await page.goto('https://example.com/form-contract');
 const read=async()=>mergeFieldSemantics(await page.evaluate(()=>[...document.querySelectorAll('input,select,textarea')].map(e=>({name:e.name,type:e.type,label:'',required:!!e.required,visible:true,value:e.value,checked:e.checked,form_id:e.form?.id}))),await page.evaluate(formFieldSemantics));
 let fields=await read();assert.equal(fields[0].label,'Experience');assert.equal(fields[0].required,true);assert.equal(fields[1].group_label,'Payment terms?');assert.equal(fields[3].required,true);result.tests.push('live_dom_custom_labels_required_and_groups');
 await page.locator('textarea').fill('Verified experience');await page.locator('input[value=Yes]').check();await page.locator('select').selectOption('No');fields=await read();assert.equal(missingRequiredFields(fields).length,0);assert.equal(fields[2].checked,false);result.tests.push('required_checkbox_group_accepts_one_observed_choice');
 await page.locator('input[value=Yes]').uncheck();assert.equal(missingRequiredFields(await read()).length,2);result.tests.push('empty_required_group_blocks_readiness');
 await assert.rejects(chooseLeverLocation(page,page.locator('#location-input'),'Wroclaw, Poland'),/LEVER_LOCATION_LOOKUP_HTTP_403/);
 assert.equal(await page.locator('#location-input').inputValue(),'');result.tests.push('location_http_failure_clears_unconfirmed_text');result.pass=true;
}catch(error){result.pass=false;result.error=error.message;process.exitCode=1;}
finally{await browser?.close().catch(()=>{});child.kill();await fs.writeFile('data/acceptance/obscura-form-contract.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
