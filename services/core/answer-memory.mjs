import {randomUUID} from 'node:crypto';
const fold=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').toLowerCase().replace(/[_\W]+/g,' ').trim();
export function productUsageIntent(field){
 // A basic use confirmation cannot answer professional use, duration, specific
 // features or production experience. Optional details are scoped separately.
 const label=String(field.label??field.field_label??field.question??'').trim();
 if(field.description?.trim()||field.group_label?.trim()&&field.group_label.trim()!==label)return null;
 const match=label.match(/^have you (?:ever )?used ([a-z0-9][a-z0-9.+-]{1,39})(?:\s*[-–—]\s*even in a personal or side project)?\s*\?(?:\s*what did you build or explore\?)?$/i);
 return match?{key:'product_usage',scope:{product:match[1].toLowerCase(),extent:'ANY_USE'}}:null;
}
export function answerIntent(field,{country,roleContext,employmentType}={}){
 const productUse=productUsageIntent(field);if(productUse)return productUse;
 const text=fold(field.label??field.field_label??field.question),name=fold(field.name??field.field_name);
 const jurisdiction=/\b(?:poland|polska|polsce)\b/.test(text)?'PL':/\b(?:germany|niemcy|niemczech)\b/.test(text)?'DE':/\b(?:united states|usa|u s a)\b/.test(text)?'USA':/\b(?:european union|unia europejska|unii europejskiej)\b/.test(text)?'EU':null;
 if(/captcha|password|passcode|otp|2fa|token|privacy|consent|agree|zgod|oswiadczen|passport|bank/.test(text+' '+name))return null;
 let key;
 const scope={};
 if(/salary|compensation|wynagrodzen|oczekiwania finansowe/.test(text+' '+name)){
  key='salary_expectation';
  const currency=(text.match(/\b(pln|eur|usd|gbp)\b/)??[])[1];
  const period=/month|monthly|miesiac|miesiecz/.test(text)?'MONTH':/annual|year|rocz/.test(text)?'YEAR':/hour|godzin/.test(text)?'HOUR':null;
  const basis=/gross|brutto/.test(text)?'GROSS':/net|netto/.test(text)?'NET':null;
  if(!currency||!period||!basis)return null;
  Object.assign(scope,{currency:currency.toUpperCase(),period,basis,country:country??'UNKNOWN'});
  const explicitContract=/\bb2b\b|business to business/.test(text)?'B2B':/\buop\b|umowa o prace|employment contract/.test(text)?'EMPLOYMENT_CONTRACT':/umowa zlecenie/.test(text)?'CIVIL_MANDATE':null;
  if(roleContext)scope.role_context=fold(roleContext);
  if(explicitContract||employmentType)scope.contract_terms=explicitContract??fold(employmentType);
 }else if(/earliest.*(?:start|date)|start date|when.*(?:start|join)|dostepnosc|kiedy.*rozpocz|termin.*rozpocz/.test(text+' '+name))key='start_date';
 else if(/notice period|okres wypowiedzenia/.test(text+' '+name))key='notice_period';
 else if(/work authori|right to work|prawo do pracy/.test(text)){if(!jurisdiction)return null;key='work_authorization';scope.country=jurisdiction;}
 else if(/sponsor|visa|wiza/.test(text)){if(!jurisdiction)return null;key='visa_sponsorship';scope.country=jurisdiction;}
 else if(/github profile|github profile url|link to your github profile|^github(?: or personal website)?$/.test(text)){key='github_profile_url';scope.host='github.com';}
 else if(/linkedin profile|linkedin profile url|link to your linkedin profile/.test(text)){key='linkedin_profile_url';scope.host='www.linkedin.com';}
 else return null;
 return {key,scope};
}
export async function rememberQuestionAnswer(client,{question,application,answer,source}){
 const job=(await client.query("SELECT country,title,metadata->>'employment_type' AS employment_type,metadata FROM jobs WHERE job_id=$1",[application.job_id])).rows[0];
 const pending=application.last_state?.pending_question??{};
 let intent=answerIntent({...pending,label:question.raw_question},{country:job?.country,roleContext:job?.metadata?.role_family??job?.title??application.job_id,employmentType:job?.employment_type});
 if(!intent)return null;
 if(intent.key==='product_usage'){
  const value=fold(answer),product=fold(intent.scope.product);
  if(!['yes','no',`yes i have used ${product}`,`no i have not used ${product}`].includes(value)){
   // Additional user-provided project facts belong to this exact question,
   // never to a generic yes/no or professional-experience prompt.
   intent={key:'product_usage_detail',scope:{...intent.scope,question:fold(question.raw_question)}};
  }
 }
 if(intent.key.endsWith('_profile_url')){let url;try{url=new URL(answer);}catch{return null;}if(url.protocol!=='https:'||url.username||url.password||!(intent.key==='github_profile_url'?url.hostname==='github.com'&&/^\/[A-Za-z0-9-]{1,39}\/?$/.test(url.pathname):['www.linkedin.com','linkedin.com'].includes(url.hostname)&&/^\/in\/[^/]+\/?$/.test(url.pathname)))return null;}
 const row=(await client.query(`INSERT INTO candidate_answer_memory(memory_id,candidate_profile_id,semantic_key,scope_json,answer_json,question_id,source)
 VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(candidate_profile_id,semantic_key,scope_json) DO UPDATE SET
 answer_json=EXCLUDED.answer_json,question_id=EXCLUDED.question_id,source=EXCLUDED.source,
 version=candidate_answer_memory.version+CASE WHEN candidate_answer_memory.answer_json IS DISTINCT FROM EXCLUDED.answer_json THEN 1 ELSE 0 END,
 active=true,updated_at=now() RETURNING memory_id,version`,[randomUUID(),application.candidate_profile_id,intent.key,intent.scope,JSON.stringify(answer),question.question_id,source])).rows[0];
 return row;
}
export async function reusableQuestionAnswer(repository,{profileId,field,job}){
 const intent=answerIntent(field,{country:job.country,roleContext:job.role_family??job.metadata?.role_family??job.title??job.job_id,employmentType:job.employment_type});if(!intent)return null;
 let row;
 if(intent.key==='product_usage'&&['text','textarea'].includes(field.type))row=(await repository.pool.query('SELECT * FROM candidate_answer_memory WHERE candidate_profile_id=$1 AND semantic_key=$2 AND scope_json=$3 AND active=true',[profileId,'product_usage_detail',{...intent.scope,question:fold(field.label??field.field_label??field.question)}])).rows[0];
 row??=(await repository.pool.query(`SELECT * FROM candidate_answer_memory WHERE candidate_profile_id=$1 AND semantic_key=$2 AND scope_json=$3 AND active=true`,[profileId,intent.key,intent.scope])).rows[0];
 if(!row)return null;
 if(['start_date','notice_period'].includes(intent.key)&&Date.now()-new Date(row.updated_at).getTime()>7*86400000)return null;
 const value=row.answer_json;
 if(field.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||Date.parse(value)<new Date().setHours(0,0,0,0)))return null;
 if(field.type==='number'&&(!/^-?\d+(?:[.,]\d+)?$/.test(value)))return null;
 if(field.options){const option=intent.key==='product_usage'?field.options.find(o=>/^(?:yes|no)$/.test(fold(o.label))&&fold(o.label)===fold(value).split(' ')[0]):field.options.find(o=>fold(o.value)===fold(value)||fold(o.label)===fold(value));if(!option)return null;return {value:option.value,source:'ANSWER_MEMORY',memory_id:row.memory_id,memory_version:row.version};}
 return {value,source:'ANSWER_MEMORY',memory_id:row.memory_id,memory_version:row.version};
}
