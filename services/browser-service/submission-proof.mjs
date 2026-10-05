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
