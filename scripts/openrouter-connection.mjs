import {mkdir,writeFile} from 'node:fs/promises';
const key=process.env.OPENROUTER_API_KEY;
if(!key)throw new Error('OPENROUTER_LOCAL_KEY_REQUIRED');
const model='google/gemma-4-26b-a4b-it:free';
const headers={authorization:`Bearer ${key}`,'content-type':'application/json'};
const authentication=await fetch('https://openrouter.ai/api/v1/key',{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
const auth=await authentication.json();
const proof={at:new Date().toISOString(),authentication_status:authentication.status,model};
if(!authentication.ok){console.log(JSON.stringify(proof));process.exit(1);}
proof.rate_limit=auth.data?.rate_limit;proof.is_free_tier=auth.data?.is_free_tier;proof.usage_daily=auth.data?.usage_daily;
const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(60000),body:JSON.stringify({model,messages:[{role:'user',content:'Return only JSON with connected set to true.'}],response_format:{type:'json_object'},reasoning:{enabled:false,exclude:true},temperature:0,max_tokens:128,stream:false})});
const data=await response.json();proof.inference_status=response.status;proof.actual_model=data.model;proof.reply=data.choices?.[0]?.message?.content;proof.finish_reason=data.choices?.[0]?.finish_reason;proof.error_code=data.error?.code;proof.usage_tokens=data.usage?.total_tokens;
await mkdir('tests/results',{recursive:true});await writeFile('tests/results/openrouter-connection.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
if(!response.ok)process.exitCode=1;
