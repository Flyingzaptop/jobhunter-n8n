import {createHash} from 'node:crypto';
export function explicitSubmissionReceipt(url,payload){
 if(payload?.errors?.length)return null;
 if(typeof payload?.confirmation_id==='string'&&payload.confirmation_id.trim()&&payload.confirmation_id.length<200)return payload.confirmation_id;
 const operation=new URL(url).searchParams.get('op')??'';
 if(!/submit.*(?:application|form)|(?:application|form).*submit/i.test(operation))return null;
 const result=payload?.data?.submitApplication??payload?.data?.submitForm;
 if(!result||result.success!==true||result.errorMessages?.length||result.formErrors?.length)return null;
 return 'ats-receipt:'+createHash('sha256').update(JSON.stringify({url,payload})).digest('hex');
}
export function submissionPageSucceeded(view){
 return !(view.validation_errors??[]).length&&!(view.fields??[]).some(f=>f.visible&&f.required)
  && /thank you for (?:your |applying|submitting)|application (?:has been |was )?(?:successfully )?(?:submitted|received)|dziękujemy za (?:aplikację|zgłoszenie)|twoja aplikacja.*(?:wysłana|otrzymana)/i.test(view.text??'');
}
export function ashbySuccessPage(view,expectedUrl){
 let url,expected;try{url=new URL(view.url);expected=new URL(expectedUrl);}catch{return false;}
 const board=url.pathname.split('/')[1],thanks=(view.text??'').match(/\bSuccess\s+Thank you for applying to ([^!\n]{1,100})!/i);
 const wording=/\bSuccess\s+Thank you\s*[—-]\s*your application was successfully submitted\./i.test(view.text??'')||thanks&&thanks[1].replace(/[^a-z0-9]/gi,'').toLowerCase()===board.replace(/[^a-z0-9]/gi,'').toLowerCase();
 return url.origin==='https://jobs.ashbyhq.com'&&url.href===expected.href&&/^\/[\w-]+\/[a-f0-9-]{36}\/application\/?$/i.test(url.pathname)
  && submissionPageSucceeded(view)&&wording
  && !(view.buttons??[]).some(b=>b.visible!==false&&/submit application/i.test(b.text??''));
}
