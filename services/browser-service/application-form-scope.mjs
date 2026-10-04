// Narrow a multi-form employer page to its uniquely identifiable CV application.
// Form-less SPA applications retain their complete snapshot and fingerprint.
export function scopeApplicationForm(view) {
 const visible=(view.fields??[]).filter(f=>f.visible);
 const candidateForms=new Set(visible.filter(f=>f.type==='file'&&f.required&&/\bresume\b|\bcv\b|curriculum vitae/i.test(`${f.name} ${f.label} ${f.selector}`)&&Number.isInteger(f.form)).map(f=>f.form));
 const activeForms=new Set(visible.filter(f=>Number.isInteger(f.form)).map(f=>f.form));
 if(activeForms.size<=1)return {pass:true,view,form_index:activeForms.values().next().value??null};
 if(candidateForms.size!==1)return {pass:false,reason:'APPLICATION_FORM_SCOPE_AMBIGUOUS',view};
 const form_index=[...candidateForms][0],form=view.forms?.[form_index];
 if(!form?.action||form.method!=='post'||!/multipart\/form-data/i.test(form.enctype??''))return {pass:false,reason:'APPLICATION_FORM_SCOPE_NOT_VERIFIED',view};
 const finalButtons=(view.buttons??[]).filter(b=>b.form_action===form.action&&b.type==='submit'&&/submit[\s\S]{0,20}application|send application/i.test(b.text??''));
 if(finalButtons.length!==1)return {pass:false,reason:'APPLICATION_FORM_SUBMIT_SCOPE_AMBIGUOUS',view};
 return {pass:true,form_index,form_id:form.id??null,view:{...view,
  fields:(view.fields??[]).filter(f=>f.form===form_index),
  buttons:(view.buttons??[]).filter(b=>b.form_action===form.action||(!b.form_action&&b.type==='link')),
  application_form_scope:{form_index,form_id:form.id??null,action:form.action,method:form.method}
 }};
}
