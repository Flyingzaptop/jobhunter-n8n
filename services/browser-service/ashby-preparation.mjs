import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const specs=JSON.parse(readFileSync(new URL('../../config/ats_preparation_queries.json',import.meta.url),'utf8')).queries;
export function ashbyCall({url,body},operation){
 let target,data;try{target=new URL(url);data=JSON.parse(Buffer.isBuffer(body)?body.toString('utf8'):body);}catch{return null;}
 const spec=specs.find(q=>q.operation_name===operation);
 if(target.origin!=='https://jobs.ashbyhq.com'||target.pathname!=='/api/non-user-graphql'||target.searchParams.get('op')!==operation||[...target.searchParams.keys()].some(k=>k!=='op')||data.operationName!==operation||Object.keys(data).some(k=>!['operationName','variables','query'].includes(k))||!spec||typeof data.query!=='string'||createHash('sha256').update(data.query).digest('hex')!==spec.query_sha256||!data.variables||Array.isArray(data.variables))return null;
 return data.variables;
}
export function reviewedAshbyGeoRead(input){const v=ashbyCall(input,'ApiAutocompleteGeoLocation');return Boolean(v&&Object.keys(v).every(k=>['text','locationTypes'].includes(k))&&typeof v.text==='string'&&v.text.length<=100&&Array.isArray(v.locationTypes)&&['Country','Country,Region,City'].includes(v.locationTypes.join(',')));}
export function reviewedAshbyUploadInit({url,body,window,now=Date.now()}){
 if(!window||window.expires_at<=now)return false;let form;try{form=new URL(window.url);}catch{return false;}
 if(form.origin!=='https://jobs.ashbyhq.com'||!/^\/[\w-]+\/[a-f0-9-]{36}\/application\/?$/i.test(form.pathname))return false;
 const v=ashbyCall({url,body},'ApiCreateFileUploadHandle');
 return Boolean(v&&Object.keys(v).length===5&&Object.keys(v).every(k=>['organizationHostedJobsPageName','fileUploadContext','filename','contentType','contentLength'].includes(k))&&v.organizationHostedJobsPageName===form.pathname.split('/')[1]&&v.fileUploadContext==='NonUserFormEngine'&&v.filename===window.filename&&v.contentType==='application/pdf'&&v.contentLength===window.byte_length);
}
export function bindAshbyStorageUpload(window,response){
 const h=response?.data?.fileUploadHandle;if(response?.errors||!h||typeof h.handle!=='string'||h.handle.length<1||h.handle.length>2000||typeof h.url!=='string'||!h.fields||typeof h.fields!=='object'||Array.isArray(h.fields))return null;
 let target;try{target=new URL(h.url);}catch{return null;}
 if(target.protocol!=='https:'||target.username||target.password||target.hostname!=='ashbyhq-infra-prd-main-app-uploaded-files-us-east-1.s3.us-east-1.amazonaws.com'||target.port||target.search||target.hash)return null;
 if(!Object.keys(h.fields).length||Object.entries(h.fields).some(([k,v])=>!/^[-A-Za-z0-9_]{1,100}$/.test(k)||typeof v!=='string'||v.length>20000))return null;
 return {url:target.href,fields:h.fields,handle:h.handle,sha256:window.sha256,filename:window.filename,expires_at:window.expires_at};
}
export function reviewedAshbyFileAttach({url,body,window,definitions,now=Date.now()}){
 if(!window?.storage||window.expires_at<=now||!window.field_path||!window.form_render_id)return false;
 const v=ashbyCall({url,body},'ApiSetFormValueToFile');let form;try{form=new URL(window.url);}catch{return false;}
 return Boolean(v&&Object.keys(v).length===5&&Object.keys(v).every(k=>['organizationHostedJobsPageName','formRenderIdentifier','path','fileHandle','formDefinitionIdentifier'].includes(k))&&v.organizationHostedJobsPageName===form.pathname.split('/')[1]&&v.formRenderIdentifier===window.form_render_id&&v.path===window.field_path&&v.fileHandle===window.storage.handle&&definitions?.has(v.formDefinitionIdentifier));
}
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).filter(k=>k!=='__typename').sort().map(k=>[k,canonical(value[k])])):value;
const locationNorm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').toLowerCase().trim();
export function matchingLocationSuggestions(suggestions,value){
 const parts=String(value).split(',').map(locationNorm);
 return suggestions.filter(s=>parts.length===1?locationNorm(s.name)===parts[0]:parts.length===2&&s.geoLocationPath?.some(p=>p.type==='City'&&locationNorm(p.name)===parts[0])&&s.geoLocationPath?.some(p=>p.type==='Country'&&locationNorm(p.name)===parts[1]));
}
export function reviewedAshbyFieldSave({url,body,windows,definitions,suggestions=[],now=Date.now()}){
 const v=ashbyCall({url,body},'ApiSetFormValue');if(!v||Object.keys(v).length!==5||Object.keys(v).some(k=>!['organizationHostedJobsPageName','formRenderIdentifier','path','value','formDefinitionIdentifier'].includes(k)))return false;
 const w=windows?.get(v.path);if(!w||w.expires_at<=now||v.formRenderIdentifier!==w.form_render_id||!definitions?.has(v.formDefinitionIdentifier))return false;
 let form;try{form=new URL(w.url);}catch{return false;}if(v.organizationHostedJobsPageName!==form.pathname.split('/')[1])return false;
 let value=v.value;if(typeof value==='string'){try{value=JSON.parse(value);}catch{}}
 const allowed=[w.value];if(w.type==='radio'){
  if(w.value===true&&typeof value==='string'&&typeof w.label==='string'&&value.trim()===w.label.trim())return true;
  if(typeof w.option_value==='string'&&w.option_value.length>0&&w.option_value!=='on')allowed.push(w.option_value);
 }
 if(w.role==='combobox')for(const suggestion of matchingLocationSuggestions(suggestions,w.value)){
  const location=suggestion.geoLocationPath?.find(p=>p.type===(String(w.value).includes(',')?'City':'Country'));if(location?.providerLocationId)allowed.push({text:suggestion.name,providerLocationId:location.providerLocationId});
 }
 return allowed.some(a=>JSON.stringify(canonical(a))===JSON.stringify(canonical(value)));
}
export function reviewedAshbyStoragePost({url,method,body,contentType,storage,now=Date.now()}){
 if(!storage||storage.expires_at<=now||url!==storage.url||method!=='POST'||!Buffer.isBuffer(body)||body.length>6*1024*1024)return false;
 const boundary=String(contentType??'').match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);if(!boundary||!/^multipart\/form-data/i.test(contentType??''))return false;
 const marker=Buffer.from('--'+(boundary[1]??boundary[2])),fields=new Set();let files=0;
 for(let start=body.indexOf(marker);start>=0;){const next=body.indexOf(marker,start+marker.length);if(next<0)break;
  const end=body.indexOf(Buffer.from('\r\n\r\n'),start);if(end<0||end>=next)return false;const header=body.subarray(start,end).toString('utf8'),name=header.match(/\bname="([^"]+)"/i)?.[1],bytes=body.subarray(end+4,next-2);
  if(/\bfilename=/i.test(header)){if(name!=='file'||header.match(/\bfilename="([^"]+)"/i)?.[1]!==storage.filename||createHash('sha256').update(bytes).digest('hex')!==storage.sha256)return false;files++;}
  else{const expected=name==='Content-Type'?'application/pdf':storage.fields[name];if((name!=='Content-Type'&&!Object.hasOwn(storage.fields,name??''))||fields.has(name)||bytes.toString('utf8')!==expected)return false;fields.add(name);}
  start=next;
 }
 return files===1&&fields.size===Object.keys(storage.fields).length+(fields.has('Content-Type')&&!Object.hasOwn(storage.fields,'Content-Type')?1:0);
}
// Chromium's request inspection omits binary file parts. Restore only the exact
// already-approved PDF, never any other file or field in the request.
export function restoreOmittedMultipartPdf(body,contentType,window){
 if(!Buffer.isBuffer(body)||!Buffer.isBuffer(window?.bytes)||createHash('sha256').update(window.bytes).digest('hex')!==window.sha256)return body;
 const boundary=String(contentType??'').match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);if(!boundary||!/^multipart\/form-data/i.test(contentType??''))return body;
 const marker=Buffer.from('--'+(boundary[1]??boundary[2]));let missing=null,files=0;
 for(let start=body.indexOf(marker);start>=0;){const next=body.indexOf(marker,start+marker.length);if(next<0)break;const end=body.indexOf(Buffer.from('\r\n\r\n'),start);if(end<0||end>=next)return body;
  const header=body.subarray(start,end).toString('utf8');if(/\bfilename=/i.test(header)){files++;if(header.match(/\bfilename="([^"]+)"/i)?.[1]===window.filename&&next-2===end+4)missing=end+4;}
  start=next;
 }
 return files===1&&missing!==null?Buffer.concat([body.subarray(0,missing),window.bytes,body.subarray(missing)]):body;
}
export async function chooseCombobox(page,locator,value,getSuggestions=()=>[]){
 if(typeof value!=='string'||!value.trim()||value.length>200)throw Error('INVALID_COMBOBOX_CHOICE');
 await locator.fill(value);await page.getByRole('option').first().waitFor({state:'visible',timeout:7000});
 const suggestions=matchingLocationSuggestions(getSuggestions(),value);if(value.includes(',')&&suggestions.length!==1)throw Error('AMBIGUOUS_COMBOBOX_CHOICE');
 const selected=value.includes(',')?suggestions[0].name:value;const options=page.getByRole('option',{name:selected,exact:true});await options.first().waitFor({state:'visible',timeout:7000});
 if(await options.count()!==1)throw Error('AMBIGUOUS_COMBOBOX_CHOICE');await options.click();
 if((await locator.inputValue()).trim().toLowerCase()!==selected.trim().toLowerCase())throw Error('COMBOBOX_CHOICE_NOT_CONFIRMED');
}
