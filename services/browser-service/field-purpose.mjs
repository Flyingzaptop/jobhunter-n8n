// Only identify controls with explicit site-UI semantics. A question mentioning
// search or dark mode is still an employer question, not a UI preference.
export function siteControlReason(field={}) {
 const type=field.field_type??field.type, label=String(field.label??field.field_label??field.question??'').trim();
 const name=field.name??field.field_name??'';
 if(type==='file'&&field.visible===false&&!field.required&&field.form==null&&!label&&
   field.selector==='#global_resume_upload_input')return 'SITE_RESUME_TOOL';
 if(field.role!=='combobox'&&(type==='search'||field.role==='searchbox'||
   field.form_method==='get'&&/^(?:search_keywords|search|q|s)$/i.test(name)&&!field.field_path))return 'SITE_SEARCH';
 if(['checkbox','radio','select-one'].includes(type)&&field.form==null&&!field.required&&!field.group_label&&!field.field_path&&
   (!name||/^(?:dark[-_]?mode|theme|color[-_]?scheme)$/i.test(name))&&
   /^(?:(?:enable|toggle) )?(?:dark mode|light mode|dark theme|light theme|tryb ciemny|tryb jasny)$/i.test(label))return 'SITE_APPEARANCE';
 return null;
}

export function withoutSiteControls(view) {
 const excluded=(view.fields??[]).filter(siteControlReason);
 if(!excluded.length)return view;
 const searchActions=new Set(excluded.filter(f=>siteControlReason(f)==='SITE_SEARCH'&&f.form_method==='get').map(f=>f.form_action).filter(Boolean));
 return {...view,fields:(view.fields??[]).filter(f=>!siteControlReason(f)),
  buttons:(view.buttons??[]).filter(b=>!(b.type==='submit'&&searchActions.has(b.form_action)))};
}
