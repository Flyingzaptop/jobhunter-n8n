import {createHash,randomUUID} from 'node:crypto';
const hash=v=>createHash('sha256').update(v).digest('hex');
export function trustedCaptchaProvider(value,config={}){
 let u;try{u=new URL(value);}catch{return null;}
 if(u.protocol==='https:'&&['www.google.com','www.recaptcha.net'].includes(u.hostname)&&/^\/recaptcha\/(?:api2|enterprise)\/(?:anchor|bframe)$/.test(u.pathname))return 'recaptcha';
 if(u.protocol==='https:'&&['newassets.hcaptcha.com','assets.hcaptcha.com'].includes(u.hostname)&&/\/captcha\/[^/]+\/.*hcaptcha\.html$/.test(u.pathname))return 'hcaptcha';
 if(config.allowMockNetwork&&u.origin==='http://127.0.0.1:3002'&&u.pathname==='/__test/captcha-provider')return 'fixture';
 return null;
}
export function reviewedHumanCaptchaPost(value,window,config={},now=Date.now()){
 if(!window||window.expires_at<=now)return false;
 let u;try{u=new URL(value);}catch{return false;}
 if(window.provider==='recaptcha')return u.protocol==='https:'&&['www.google.com','www.recaptcha.net'].includes(u.hostname)&&/^\/recaptcha\/(?:api2|enterprise)\/(?:reload|userverify|replaceimage)$/.test(u.pathname);
 if(window.provider==='hcaptcha')return u.protocol==='https:'&&u.hostname==='api.hcaptcha.com'&&/^\/(?:getcaptcha|checkcaptcha)\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)?$/.test(u.pathname);
 return window.provider==='fixture'&&config.allowMockNetwork&&u.origin==='http://127.0.0.1:3002'&&u.pathname==='/__test/captcha-verify';
}
export function captchaObserverUrl(value){
 try{const u=new URL(value);if((['www.google.com','www.recaptcha.net'].includes(u.hostname)&&u.pathname.startsWith('/recaptcha/'))||['api.hcaptcha.com','newassets.hcaptcha.com','assets.hcaptcha.com'].includes(u.hostname)){u.search='';u.hash='';if(u.hostname==='api.hcaptcha.com')u.pathname=u.pathname.replace(/^\/(getcaptcha|checkcaptcha)\/.*$/,'/$1/[redacted]');return u.href;}}catch{}
 return null;
}
export async function observePendingCaptcha(page,config={}){
 const frames=[];
 for(const frame of page.frames()){
  let url;try{url=new URL(frame.url());}catch{continue;}
  if(!/captcha/i.test(url.href))continue;
  let element;try{element=await frame.frameElement();}catch{continue;}
  const visible=await element.isVisible(),box=await element.boundingBox();
  const provider=trustedCaptchaProvider(frame.url(),config),size=['invisible','normal','compact'].includes(url.searchParams.get('size'))?url.searchParams.get('size'):null;
  const display=await element.evaluate(e=>({opacity:Number(getComputedStyle(e).opacity),title:e.title,onscreen:e.getBoundingClientRect().bottom>0&&e.getBoundingClientRect().right>0&&e.getBoundingClientRect().top<innerHeight&&e.getBoundingClientRect().left<innerWidth}));
  let checkboxVisible=false,checked=false;
  if(provider)try{const checkbox=frame.locator('#recaptcha-anchor,[role="checkbox"]').first();checkboxVisible=await checkbox.count()>0&&await checkbox.isVisible();checked=checkboxVisible&&(await checkbox.getAttribute('aria-checked'))==='true';}catch{}
  const rendered=visible&&display.opacity>0.05&&Boolean(box&&box.width>=20&&box.height>=20);
  const isChallenge=provider==='recaptcha'&&url.pathname.endsWith('/bframe')||provider==='hcaptcha'&&/main content/i.test(display.title)||provider==='fixture';
  const pending=provider?(checkboxVisible&&!checked||rendered&&display.onscreen&&isChallenge&&!(provider==='fixture'&&checked)||provider==='recaptcha'&&url.pathname.endsWith('/anchor')&&rendered&&size!=='invisible'&&!checkboxVisible):rendered&&display.onscreen;
  frames.push({provider:provider??'unknown',path:url.pathname,size,visible:rendered,onscreen:display.onscreen,checkbox_visible:checkboxVisible,checked,challenge_frame:isChallenge,pending});
 }
 const customPending=await page.evaluate(()=>[...document.querySelectorAll('[data-captcha]')].some(e=>Boolean(e.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden'));
 return {pending:customPending||frames.some(f=>f.pending),custom_pending:customPending,frames};
}
async function region(page,config){
 const regions=[];
 for(const frame of page.frames()){
  const provider=trustedCaptchaProvider(frame.url(),config);if(!provider)continue;
  let element;try{element=await frame.frameElement();}catch{continue;}
  if(!await element.isVisible())continue;
  const box=await element.boundingBox();
  if(!box||box.width<20||box.height<20||box.width>1000||box.height>800||box.width*box.height>600000)continue;
  if(!await element.evaluate(e=>Number(getComputedStyle(e).opacity)>0.05))continue;
  regions.push({provider,frame,element,box,provider_hash:hash(frame.url())});
 }
 return regions.sort((a,b)=>b.box.width*b.box.height-a.box.width*a.box.height)[0]??null;
}
const sameBox=(a,b)=>['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<=1);
async function unobstructedFrameChain(frame,point){
 for(let current=frame;current.parentFrame();current=current.parentFrame()){
  const element=await current.frameElement(),box=await element.boundingBox();
  if(!box||point.x<box.x||point.y<box.y||point.x>=box.x+box.width||point.y>=box.y+box.height)return false;
  const visible=await element.evaluate((e,p)=>{const b=e.getBoundingClientRect();return document.elementFromPoint(b.x+p.x*b.width,b.y+p.y*b.height)===e;},{x:(point.x-box.x)/box.width,y:(point.y-box.y)/box.height});
  if(!visible)return false;
 }
 return true;
}
export async function humanCaptchaView(session,config,{now=Date.now(),ttlMs=30000}={}){
 const selected=await region(session.page,config);if(!selected)throw new Error('VISIBLE_TRUSTED_CAPTCHA_UNAVAILABLE');
 const masks=session.page.frames().map(f=>f.locator('input,textarea,select'));
 const png=await selected.element.screenshot({mask:masks,maskColor:'#18212a',timeout:5000});
 if(png.length>2*1024*1024)throw new Error('CAPTCHA_CAPTURE_TOO_LARGE');
 // Element screenshot may scroll the page. Bind the post-capture rectangle.
 const box=await selected.element.boundingBox();if(!box)throw new Error('CAPTCHA_REGION_CHANGED');
 const viewId=randomUUID(),record={provider:selected.provider,provider_hash:hash(selected.frame.url()),box,page_hash:hash(session.page.url()),expires_at:now+ttlMs};
 session.humanCaptchaViews??=new Map();session.humanCaptchaViews.clear();session.humanCaptchaViews.set(viewId,record);
 return {view_id:viewId,provider:selected.provider,provider_hash:record.provider_hash,width:box.width,height:box.height,expires_at:new Date(record.expires_at).toISOString(),png_base64:png.toString('base64'),scope:'TRUSTED_CAPTCHA_FRAME_CROP',redacted:true,persisted:false};
}
export async function humanCaptchaClick(session,config,payload,{now=Date.now()}={}){
 if(payload.source!=='USER_DASHBOARD'||payload.confirmed!==true||Object.keys(payload).some(k=>!['source','confirmed','view_id','x','y'].includes(k)))throw new Error('EXPLICIT_HUMAN_CAPTCHA_ACTION_REQUIRED');
 const saved=session.humanCaptchaViews?.get(payload.view_id);if(!saved)throw new Error('CAPTCHA_VIEW_STALE_OR_REPLAYED');
 session.humanCaptchaViews.delete(payload.view_id);
 if(saved.expires_at<=now||saved.page_hash!==hash(session.page.url()))throw new Error('CAPTCHA_VIEW_EXPIRED');
 const {x,y}=payload;if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=saved.box.width||y>=saved.box.height)throw new Error('CAPTCHA_CLICK_OUTSIDE_REGION');
 const selected=await region(session.page,config);
 if(!selected||selected.provider_hash!==saved.provider_hash||!sameBox(selected.box,saved.box))throw new Error('CAPTCHA_REGION_CHANGED');
 const unobstructed=await unobstructedFrameChain(selected.frame,{x:saved.box.x+x,y:saved.box.y+y});
 if(!unobstructed)throw new Error('CAPTCHA_REGION_OBSTRUCTED');
 session.humanCaptchaWindow={provider:saved.provider,expires_at:now+15000};
 session.humanCaptchaAction={provider:saved.provider,at:now,page_hash:saved.page_hash};
 await session.page.mouse.click(saved.box.x+x,saved.box.y+y);
 session.history.push({operation:'human_captcha_click',source:'USER_DASHBOARD',timestamp:new Date(now).toISOString()});
 return {human_action_accepted:true,verification_window_ms:15000,submission_enabled:false};
}
export async function inspectHumanCaptchaCompletion(session,config,{now=Date.now()}={}){
 const action=session.humanCaptchaAction;
 if(!action||now-action.at>120000||action.page_hash!==hash(session.page.url()))return {verified:false,reason:'FRESH_HUMAN_CAPTCHA_ACTION_REQUIRED'};
 let checked=false;
 for(const frame of session.page.frames()){
  if(trustedCaptchaProvider(frame.url(),config)!==action.provider)continue;
  try{checked ||= await frame.evaluate(()=>Boolean(document.querySelector('#recaptcha-anchor[aria-checked="true"],[role="checkbox"][aria-checked="true"]')));}catch{}
 }
 // Only the boolean crosses the browser boundary; token strings are never returned.
 const responsePresent=await session.page.evaluate(()=>[...document.querySelectorAll('[name="g-recaptcha-response"],[name="h-captcha-response"]')].some(e=>Boolean(e.value)));
 return checked&&responsePresent?{verified:true,observed_at:new Date(now).toISOString(),provider:action.provider}:{verified:false,reason:'PROVIDER_VERIFICATION_NOT_OBSERVED'};
}
