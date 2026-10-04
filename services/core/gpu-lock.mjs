export async function withExclusiveLocalGpu(repository,operation){
 const client=await repository.pool.connect();let acquired=false;
 try{
  acquired=(await client.query("SELECT pg_try_advisory_lock(hashtext('jobhunter.relevance-fit-batch')) AS locked")).rows[0].locked;
  if(!acquired)return {blocked_reason:process.env.OLLAMA_PROVIDER&&process.env.OLLAMA_PROVIDER!=='local'?'INFERENCE_BATCH_BUSY':'LOCAL_GPU_BUSY',processed:0};
  return await operation();
 }finally{
  try{if(acquired)await client.query("SELECT pg_advisory_unlock(hashtext('jobhunter.relevance-fit-batch'))");}finally{client.release();}
 }
}
