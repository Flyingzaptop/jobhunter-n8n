export function confirmedConsentScopeMatches(field,view,confirmed,context){
 return Boolean(confirmed?.question_id&&confirmed.label===field.label&&confirmed.type===field.type&&confirmed?.question_type==='CONSENT'&&context?.profile_hash&&context.cv_sha256&&confirmed.page_url===view.url
  &&confirmed.form_action===(field.form_action??null)&&confirmed.required===field.required
  &&confirmed.context&&Object.keys(context).every(key=>confirmed.context[key]===context[key])
  &&Object.keys(confirmed.context).length===Object.keys(context).length);
}
export function confirmedFieldMatches(field,view,confirmed,context){
 const scopedConsent=confirmedConsentScopeMatches(field,view,confirmed,context);
 return Boolean(confirmed&&field.selector&&confirmed.label===field.label&&confirmed.type===field.type
  &&(confirmed.question_type==='CONSENT'&&confirmed.context?scopedConsent:confirmed.fingerprint===view.fingerprint)&&confirmed.value===field.value&&confirmed.question_id
  &&(!['checkbox','radio'].includes(field.type)||field.checked===(confirmed.checked??true)));
}
