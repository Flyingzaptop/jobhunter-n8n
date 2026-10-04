import {writeFile,mkdir} from 'node:fs/promises';
import {OllamaClient} from '../services/core/llm.mjs';
import {Repository} from '../services/core/repository.mjs';
const client=new OllamaClient();
if(client.provider==='local')throw new Error('Cloud-only resume required');
if(!(await client.health()).ok)throw new Error('Verified cloud model unavailable');
const repository=new Repository();try{
 await repository.migrate();
 // This command is run after the user explicitly resumes in Cloud and after
 // verifying no prior JobHunter/Ollama local worker process remains active.
 const interrupted=(await repository.pool.query("UPDATE operation_runs SET status='PAUSED',completed_at=now(),message='Local run stopped by user; continuing in Cloud' WHERE status='RUNNING' AND trigger='relevance-queue' RETURNING run_id")).rows;
 for(const row of interrupted)await repository.event('operation',row.run_id,'LOCAL_RUN_PAUSED_FOR_CLOUD',{reason:'USER_REQUEST',new_provider:client.provider,new_model:client.model});
 await repository.pool.query("UPDATE runtime_control SET paused=false,updated_at=now() WHERE id=true");
 await mkdir('data/runtime',{recursive:true});await writeFile('data/runtime/cloud-resume.json',JSON.stringify({resumed_at:new Date().toISOString(),provider:client.provider,model:client.model,local_inference_allowed:false,real_submit_enabled:false},null,2));
 console.log(JSON.stringify({cloud_resume:true,provider:client.provider,model:client.model,interrupted_runs_preserved:interrupted.length,local_inference_allowed:false}));
}finally{await repository.close();}
