import {Repository} from '../services/core/repository.mjs';
import {BrowserClient} from '../services/core/application.mjs';
import {Telegram} from '../services/core/telegram.mjs';
import {drainCaptchaHandoffs} from '../services/core/captcha-handoff.mjs';
const repository=new Repository(),browser=new BrowserClient(),telegram=new Telegram();
const once=process.argv.includes('--once'),interval=Number(process.env.CAPTCHA_HANDOFF_POLL_MS||30000);
if(!Number.isInteger(interval)||interval<5000||interval>300000)throw new Error('INVALID_CAPTCHA_HANDOFF_POLL_MS');
let stopping=false,wake;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;wake?.();});
const observed=new Map();
try{
 await repository.migrate();
 do{
  if(!(await repository.pool.query('SELECT paused FROM runtime_control WHERE id=true')).rows[0]?.paused){
   try{const result=await drainCaptchaHandoffs({repository,browser,telegram,limit:5});for(const row of result.results){if(observed.get(row.handoff_id)!==row.delivery_status){observed.set(row.handoff_id,row.delivery_status);console.log(JSON.stringify({event:'CAPTCHA_HANDOFF_STATUS',...row}));}}}
   catch{console.error(JSON.stringify({event:'CAPTCHA_HANDOFF_CYCLE_FAILED',error_code:'OUTBOX_DELIVERY_FAILED',global_pause_changed:false}));}
  }
  if(!once&&!stopping)await new Promise(resolve=>{const timer=setTimeout(()=>{wake=null;resolve();},interval);wake=()=>{clearTimeout(timer);wake=null;resolve();};});
 }while(!once&&!stopping);
}finally{await repository.close();}
