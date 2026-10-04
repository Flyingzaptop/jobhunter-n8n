export async function settleApplicationForm({browser,sessionId,initialView,maxMs=6000}){
 const started=Date.now();let view=initialView,previous=null,stable=0;
 while(Date.now()-started<maxMs){
  view=await browser.call(`/sessions/${sessionId}/snapshot`);
  const ready=view.fields?.some(f=>f.visible&&['text','email','tel','textarea','file'].includes(f.type));
  stable=ready&&view.fingerprint===previous?stable+1:0;previous=view.fingerprint;
  if(ready&&stable>=2&&Date.now()-started>=1000)return view;
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 return view;
}
