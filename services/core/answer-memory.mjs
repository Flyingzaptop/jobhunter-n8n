import {randomUUID} from 'node:crypto';
const fold=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').toLowerCase().replace(/[_\W]+/g,' ').trim();
export function answerIntent(field,{country}={}){
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
 }else if(/earliest.*(?:start|date)|start date|when.*(?:start|join)|dostepnosc|kiedy.*rozpocz|termin.*rozpocz/.test(text+' '+name))key='start_date';
 else if(/notice period|okres wypowiedzenia/.test(text+' '+name))key='notice_period';
 else if(/work authori|right to work|prawo do pracy/.test(text)){if(!jurisdiction)return null;key='work_authorization';scope.country=jurisdiction;}
 else if(/sponsor|visa|wiza/.test(text)){if(!jurisdiction)return null;key='visa_sponsorship';scope.country=jurisdiction;}
 else return null;
 return {key,scope};
}
export async function rememberQuestionAnswer(client,{question,application,answer,source}){
 const job=(await client.query('SELECT country FROM jobs WHERE job_id=$1',[application.job_id])).rows[0];
 const pending=application.last_state?.pending_question??{};
 const intent=answerIntent({...pending,label:question.raw_question},{country:job?.country});
 if(!intent)return null;
 const row=(await client.query(`INSERT INTO candidate_answer_memory(memory_id,candidate_profile_id,semantic_key,scope_json,answer_json,question_id,source)
 VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(candidate_profile_id,semantic_key,scope_json) DO UPDATE SET
 answer_json=EXCLUDED.answer_json,question_id=EXCLUDED.question_id,source=EXCLUDED.source,
 version=candidate_answer_memory.version+CASE WHEN candidate_answer_memory.answer_json IS DISTINCT FROM EXCLUDED.answer_json THEN 1 ELSE 0 END,
 active=true,updated_at=now() RETURNING memory_id,version`,[randomUUID(),application.candidate_profile_id,intent.key,intent.scope,JSON.stringify(answer),question.question_id,source])).rows[0];
 return row;
}
export async function reusableQuestionAnswer(repository,{profileId,field,job}){
 const intent=answerIntent(field,{country:job.country});if(!intent)return null;
 const row=(await repository.pool.query(`SELECT * FROM candidate_answer_memory WHERE candidate_profile_id=$1 AND semantic_key=$2 AND scope_json=$3 AND active=true`,[profileId,intent.key,intent.scope])).rows[0];
 if(!row)return null;
 if(['start_date','notice_period'].includes(intent.key)&&Date.now()-new Date(row.updated_at).getTime()>7*86400000)return null;
 const value=row.answer_json;
 if(field.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||Date.parse(value)<new Date().setHours(0,0,0,0)))return null;
 if(field.type==='number'&&(!/^-?\d+(?:[.,]\d+)?$/.test(value)))return null;
 if(field.options){const option=field.options.find(o=>fold(o.value)===fold(value)||fold(o.label)===fold(value));if(!option)return null;return {value:option.value,source:'ANSWER_MEMORY',memory_id:row.memory_id,memory_version:row.version};}
 return {value,source:'ANSWER_MEMORY',memory_id:row.memory_id,memory_version:row.version};
}
