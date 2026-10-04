import {mkdir,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
let pending=Promise.resolve();
export function persistModelProgress(model,request){
 const record={model,stage:request.stage,started_at:request.started_at,
  prompt_processing_progress:request.prompt_processing_progress,generated_fragments:request.generated_fragments,
  input_tokens:request.measured_input_tokens,context_tokens:request.context_tokens,
  elapsed_ms:request.started_at?Date.now()-Date.parse(request.started_at):null,
  last_progress_elapsed_ms:request.last_progress_elapsed_ms,updated_at:new Date().toISOString()};
 pending=pending.then(async()=>{const root=path.resolve('data/runtime');await mkdir(root,{recursive:true});
  const temporary=path.join(root,'model-progress.tmp.json'),target=path.join(root,'model-progress.json');
  await writeFile(temporary,JSON.stringify(record),'utf8');await rename(temporary,target);
 }).catch(()=>{});
}
