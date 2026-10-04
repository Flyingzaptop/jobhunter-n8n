import {writeFile,mkdir} from 'node:fs/promises';
import {OllamaClient} from '../services/core/llm.mjs';
const client=new OllamaClient();
if(client.provider==='local')throw new Error('CLOUD_PROVIDER_REQUIRED');
const data=await client.json({system:'Return only the requested JSON object.',prompt:'Set cloud_connection to true.',schema:{type:'object',properties:{cloud_connection:{const:true}},required:['cloud_connection'],additionalProperties:false}});
const result={pass:data.cloud_connection===true,model:client.model,remote_model:client.lastStats.remote_model,provider:client.provider,semantic_attempts:client.lastStats.semantic_attempts};
await mkdir('tests/results',{recursive:true});await writeFile('tests/results/ollama-cloud-connection.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
