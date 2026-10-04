import {createHash} from 'node:crypto';
export function draftNavigationWindow(snapshot,button,now=Date.now()){
 const label=String(button.text??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 if(button.final_submit||!button.name||!button.value||!/^(?:next|continue|dalej|kontynuuj|nastepny krok)$/.test(label)||!/next|continue|dalej|kontynuuj|save.?draft/i.test(button.value))return null;
 const action=button.formAction??button.form_action??snapshot.forms?.find(f=>f.id===button.form_id)?.action??snapshot.url;
 const target=new URL(action,snapshot.url);if(target.origin!==new URL(snapshot.url).origin)return null;
 return {url:target.href,name:button.name,value:String(button.value),expires_at:now+10000};
}
export function reviewedDraftRequest({url,method,body,contentType,window,now=Date.now()}){
 if(!window||window.expires_at<=now||url!==window.url||method!=='POST'||!Buffer.isBuffer(body)||body.length>256000)return false;
 let data;
 try{if(/^application\/x-www-form-urlencoded/i.test(contentType??''))data=Object.fromEntries(new URLSearchParams(body.toString('utf8')));
 else if(/^application\/json/i.test(contentType??''))data=JSON.parse(body.toString('utf8'));else return false;}catch{return false;}
 if(String(data[window.name]??'')!==window.value)return false;
 return !Object.entries(data).some(([key,value])=>/^(?:action|operation|event|eventid|submit)$/i.test(key)&&/^(?:send|submit|apply|wyslij|confirm)$/i.test(String(value)));
}
export function reviewedUploadRequest({url,method,body,contentType,window,now=Date.now()}){
 if(!window||window.expires_at<=now||method!=='POST'||!Buffer.isBuffer(body)||body.length>6*1024*1024)return false;
 const target=new URL(url),origin=new URL(window.url);
 if(target.origin!==origin.origin||!/\/(?:upload|uploads|attachment|attachments|files|documents)\/?$/i.test(target.pathname))return false;
 if(/^application\/pdf(?:;|$)/i.test(contentType??''))return createHash('sha256').update(body).digest('hex')===window.sha256;
 const boundary=String(contentType??'').match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
 if(!boundary||!/^multipart\/form-data/i.test(contentType))return false;
 const marker=Buffer.from('--'+(boundary[1]??boundary[2]));let found=0;
 for(let start=body.indexOf(marker);start>=0;){
  const next=body.indexOf(marker,start+marker.length);if(next<0)break;
  const headerEnd=body.indexOf(Buffer.from('\r\n\r\n'),start);if(headerEnd<0||headerEnd>=next)return false;
  const headers=body.subarray(start,headerEnd).toString('utf8');
  if(/filename=/i.test(headers)){
   const bytes=body.subarray(headerEnd+4,next-2);
   if(createHash('sha256').update(bytes).digest('hex')!==window.sha256)return false;found++;
  }
  start=next;
 }
 return found===1;
}
