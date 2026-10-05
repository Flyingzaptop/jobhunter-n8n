import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {dismissPracaCookies} from '../services/browser-service/praca-cookies.mjs';
test('Praca cookie customization handles a non-button reject control and never accepts all cookies',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();
  await page.route('https://www.praca.pl/**',route=>route.fulfill({contentType:'text/html',body:'<div id="lPopups" style="width:0;height:0"><div style="position:fixed;left:0;top:0">Zgoda na Pliki Cookies<button id="custom">Akceptuj wybrane</button><button id="all">Akceptuj wszystkie</button></div></div>'}));
  await page.goto('https://www.praca.pl/isolated-cookie-fixture');
  await page.evaluate(()=>{document.querySelector('#all').onclick=()=>document.body.dataset.accepted='all';document.querySelector('#custom').onclick=()=>{document.querySelector('#lPopups').innerHTML='Dostosuj zgody: plików Cookies<span id="reject">ODRZUĆ WSZYSTKIE</span>';document.querySelector('#reject').onclick=()=>{document.body.dataset.accepted='necessary';document.querySelector('#lPopups').style.display='none';};};});
  assert.equal((await dismissPracaCookies(page)).status,'DISMISSED');
  assert.equal(await page.locator('body').getAttribute('data-accepted'),'necessary');
 }finally{await browser.close();}
});
