import {mkdir,writeFile} from 'node:fs/promises';
import {Repository} from '../services/core/repository.mjs';
const repository=new Repository();try{
 await repository.pool.query('UPDATE runtime_control SET paused=true,updated_at=now() WHERE id=true');
 const runs=(await repository.pool.query("SELECT run_id,stage,model,status,processed_count,success_count,failure_count,message FROM (SELECT r.*,r.metadata->'result_summary'->>'model' AS model FROM operation_runs r) s ORDER BY started_at DESC LIMIT 15")).rows;
 const counts=(await repository.pool.query('SELECT status,count(*)::int count FROM relevance_queue GROUP BY status')).rows;
 const receiptCounts=(await repository.pool.query('SELECT model,prompt_version,count(DISTINCT job_id)::int jobs FROM fit_batch_receipts GROUP BY model,prompt_version ORDER BY model,prompt_version')).rows;
 const cvs=(await repository.pool.query('SELECT cv_id,job_id,model,pdf_path,sha256 FROM cv_versions ORDER BY created_at DESC LIMIT 10')).rows;
 const checkpoint={paused_at:new Date().toISOString(),reason:'USER_WINDOWS_UPDATE',runs,queue:counts,fit_receipts:receiptCounts,cv_artifacts:cvs,next_provider:'openrouter',requested_model:'Gemma 4 26B A4B free; verify exact model ID and availability on resume',real_employer_submissions:0,resume_only_on_user_request:true};
 await mkdir('data/runtime',{recursive:true});await writeFile('data/runtime/windows-update-checkpoint.json',JSON.stringify(checkpoint,null,2),{mode:0o600});
 await repository.pool.query('CHECKPOINT');
 console.log(JSON.stringify({paused:true,checkpoint_saved:true,fit_receipts:receiptCounts,approved_cv_count:cvs.length}));
}finally{await repository.close();}
