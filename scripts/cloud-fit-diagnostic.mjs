import {readFile} from 'node:fs/promises';
import YAML from 'yaml';
import Ajv from 'ajv';
import {Repository} from '../services/core/repository.mjs';
import {OllamaClient} from '../services/core/llm.mjs';
import {analyzeJob} from '../services/core/fit.mjs';
import {reverifyMarketJob} from '../services/core/discovery-v2.mjs';
const repository=new Repository(),ajv=new Ajv({allErrors:true,strict:true});let check,sourceIndex=new Map();
const client=new OllamaClient({fetchImpl:async(url,options)=>{
 const response=await fetch(url,options);
 if(String(url).endsWith('/api/chat')&&response.ok&&check){
  try{const data=await response.clone().json();let text=data.message?.content??'';const fenced=text.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);if(fenced)text=fenced[1];const value=JSON.parse(text);if(!check(value))console.log(JSON.stringify({phase:'schema',issues:check.errors.slice(0,8).map(e=>({path:e.instancePath,keyword:e.keyword,field:e.params?.missingProperty??e.params?.additionalProperty}))}));else for(const [id,row]of Object.entries({...value.explicit_requirements,...value.requirements}))if(['YES','PARTIAL'].includes(row.match)&&!row.candidate_evidence_fact_ids?.length)console.log(JSON.stringify({phase:'missing_evidence',source_id:id,source_quote:sourceIndex.get(Number(id))}));}catch{}
 }
 return response;
}});
if(client.provider==='local')throw new Error('Cloud-only diagnostic required');
const gateway={wireFormat:'compact',model:client.model,strongModel:client.strongModel,json:async request=>{check=ajv.compile(request.schema);sourceIndex=new Map((JSON.parse(request.prompt).source_fragments_untrusted_data??[]).map(f=>[f.id,f.text]));const validate=request.validate;return client.json({...request,validate:async value=>{try{return await validate?.(value);}catch(e){console.log(JSON.stringify({phase:'semantic',reason:e.message.slice(0,240)}));throw e;}}});}};
try{
 const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8')),policy=YAML.parse(await readFile('config/search_policy.yaml','utf8'));
 const job=(await repository.listCanonicalJobs()).find(j=>j.job_id===(process.argv[2]??'55f8b831-91dc-5b6b-a173-7c24d9e9f4ba'));
 const verified=await reverifyMarketJob({job,repository});if(verified.status!=='OPEN')throw new Error('Actual source not verified OPEN');
 const analysis=await analyzeJob({job:verified.job??job,profile,policy,llm:gateway});console.log(JSON.stringify({status:'VALIDATED',decision:analysis.decision,requirements:analysis.requirements.length}));
}catch(error){console.log(JSON.stringify({status:'BLOCKED',code:error.code??error.name,validation_codes:client.lastStats?.validation_codes}));process.exitCode=1;}finally{await repository.close();}
