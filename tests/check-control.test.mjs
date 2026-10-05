import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {setCheckedControl} from '../services/browser-service/check-control.mjs';
test('styled hidden checkbox is changed through its actual visible label and verified',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent('<input id="terms" type="checkbox" style="display:none"><label for="terms">Accept regulations</label>');
  await setCheckedControl(page,page.locator('#terms'),true);assert.equal(await page.locator('#terms').isChecked(),true);
  await setCheckedControl(page,page.locator('#terms'),false);assert.equal(await page.locator('#terms').isChecked(),false);
 }finally{await browser.close();}
});
