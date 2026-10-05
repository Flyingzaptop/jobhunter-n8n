const formScope=field=>field.form_selector??field.form_id??field.form??null;
export function missingRequiredFields(fields=[]){
 return fields.filter(f=>f.visible&&f.required&&!f.disabled&&(
  f.type==='radio'?!fields.some(other=>other.visible&&!other.disabled&&other.type==='radio'&&other.checked&&formScope(f)===formScope(other)&&(f.field_path?other.field_path===f.field_path:Boolean(f.name)&&other.name===f.name)):
  f.type==='checkbox'?!f.checked:Boolean(f.validation_message||!String(f.value??'').trim())
 ));
}
export function unsavedRequiredFields(fields=[]){return fields.filter(f=>f.visible&&f.required&&!f.disabled&&(f.type!=='radio'||f.checked)&&f.server_saved===false);}
