export function ashbyFormFields(form){
 const fields=new Map();
 for(const section of form?.sections??[])for(const entry of section.fieldEntries??[]){
  if(section.isHidden||entry.isHidden||typeof entry.field?.path!=='string')continue;
  let value=entry.fieldValue?.filename&&entry.fieldValue?.id?{id:entry.fieldValue.id,filename:entry.fieldValue.filename}:entry.fieldValue?.value;
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{}}
  fields.set(entry.field.path,{required:entry.isRequired===true,title:entry.field.title,type:entry.field.type,value});
 }
 return fields;
}
export function ashbyFieldSaved(field,entry){
 if(!entry||entry.value===undefined||entry.value===null)return false;
 if(field.type==='file')return typeof entry.value==='object'&&typeof entry.value.id==='string'&&typeof entry.value.filename==='string';
 if(field.type==='radio')return !field.checked||String(entry.value).trim()===String(field.label).trim();
 if(field.type==='checkbox')return entry.value===field.checked;
 if(field.role==='combobox')return typeof entry.value==='object'&&typeof entry.value.providerLocationId==='string'&&String(entry.value.text).trim()===String(field.value).trim();
 return String(entry.value).trim()===String(field.value).trim();
}
