import {createHash} from 'node:crypto';
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
