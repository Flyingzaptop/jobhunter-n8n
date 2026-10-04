import {randomInt} from 'node:crypto';
import {chromium} from 'playwright';
import {Repository} from '../services/core/repository.mjs';
import {Telegram} from '../services/core/telegram.mjs';
import {sendCaptchaTransportTest} from '../services/core/captcha-telegram.mjs';
if(!process.argv.includes('--transport-test'))throw new Error('EXPLICIT_TRANSPORT_TEST_FLAG_REQUIRED');
const index=process.argv.indexOf('--count'),count=index<0?2:Number(process.argv[index+1]);
if(![1,2].includes(count))throw new Error('TRANSPORT_TEST_COUNT_MUST_BE_ONE_OR_TWO');
const repository=new Repository(),telegram=new Telegram(),alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',codes=new Set();let browser;
try{
 await repository.migrate();if(!telegram.token||!telegram.chatId)throw new Error('TELEGRAM_NOT_CONFIGURED');
 browser=await chromium.launch({headless:true,args:['--disable-gpu']});
 for(let i=0;i<count;i++){
  let code;do{code=Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join('');}while(codes.has(code));codes.add(code);
  const page=await browser.newPage({viewport:{width:800,height:380}});
  await page.setContent(`<html><body style="margin:0;background:#132237;color:#fff;font-family:Arial,sans-serif;padding:35px"><h1>TRANSPORT_TEST ${i+1}/${count}</h1><p>Telegram photo and reply correlation only</p><div style="font-size:64px;letter-spacing:12px;font-weight:bold;padding:25px 0">${code}</div><p>Reply directly to this image with its code.</p><p>No employer CAPTCHA · No application verification · No submission</p></body></html>`);
  const png=await page.screenshot();await page.close();
  console.log(JSON.stringify(await sendCaptchaTransportTest({repository,telegram,png,code})));
 }
}finally{await browser?.close();await repository.close();}
