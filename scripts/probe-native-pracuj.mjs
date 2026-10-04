import {spawn} from 'node:child_process';import {mkdir} from 'node:fs/promises';import path from 'node:path';
import {chromium} from 'playwright';
const directory=path.resolve('data/board-diagnostics/pracuj-native');await mkdir(directory,{recursive:true});
const executable=path.join(process.env.ProgramFiles??'C:/Program Files','Google/Chrome/Application/chrome.exe');
const child=spawn(executable,['--user-data-dir='+directory,'--remote-debugging-port=9127','--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check','--start-minimized','about:blank'],{windowsHide:true,stdio:'ignore'});child.on('error',()=>{});
let browser;
try{
 for(let i=0;i<40;i++){try{const r=await fetch('http://127.0.0.1:9127/json/version');if(r.ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
 browser=await chromium.connectOverCDP('http://127.0.0.1:9127');const page=browser.contexts()[0].pages()[0];
 const response=await page.goto('https://www.pracuj.pl/praca/konstruktor;kw',{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForTimeout(7000);
 console.log(JSON.stringify({status:response?.status(),title:await page.title(),job_links:await page.locator('a[href*="oferta,"]').count(),webdriver:await page.evaluate(()=>navigator.webdriver),transport:'ORDINARY_CHROME_CDP',stealth:false,manual_login:false}));
}finally{if(browser){const session=await browser.newBrowserCDPSession();await session.send('Browser.close').catch(()=>{});}else child.kill();}
