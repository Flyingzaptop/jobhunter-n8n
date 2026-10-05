export function selectedCookieButton(view){
 let host;try{host=new URL(view.url).hostname;}catch{return null;}
 if(host!=='www.praca.pl'||!String(view.text??'').includes('Zgoda na Pliki Cookies'))return null;
 return view.buttons?.find(button=>button.visible!==false&&!button.disabled&&!button.final_submit&&button.type==='button'&&/^akceptuj wybrane$/i.test(button.text?.trim()??''))??null;
}
export async function settleApplicationForm({browser,sessionId,initialView,maxMs=6000}){
 const started=Date.now();let view=initialView,previous=null,stable=0,cookieDismissed=false;
 while(Date.now()-started<maxMs){
  view=await browser.call(`/sessions/${sessionId}/snapshot`);
  const praca=new URL(view.url??'https://invalid.local').hostname==='www.praca.pl';
  const cookie=cookieDismissed?null:selectedCookieButton(view);
  if(cookie||!cookieDismissed&&praca&&Date.now()-started>=1000){
   view=await browser.call(`/sessions/${sessionId}/dismiss-cookies`,{});cookieDismissed=view.cookie_dismissal?.status==='DISMISSED';
   if(cookieDismissed){previous=null;stable=0;continue;}
  }
  const ready=view.fields?.some(f=>f.visible&&['text','email','tel','textarea','file'].includes(f.type));
  stable=ready&&view.fingerprint===previous?stable+1:0;previous=view.fingerprint;
  if(ready&&stable>=2&&Date.now()-started>=(praca?3000:1000))return view;
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 return view;
}
