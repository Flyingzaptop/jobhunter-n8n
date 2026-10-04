import {loadMarketSources,runMarketDiscovery,createDiscoveryNormalizationState} from './discovery-v2.mjs';

export async function runSourcePool(sources,operation,{concurrency=6,hostLimit=1}={}){
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>12||hostLimit!==1)throw new Error('INVALID_DISCOVERY_CONCURRENCY');
 const pending=[...sources],activeHosts=new Set(),results=[];
 async function worker(){while(pending.length){
  const index=pending.findIndex(source=>!activeHosts.has(new URL(source.url).hostname));
  if(index<0){await new Promise(r=>setTimeout(r,20));continue;}
  const source=pending.splice(index,1)[0],host=new URL(source.url).hostname;activeHosts.add(host);
  try{results.push({source_id:source.name,status:'COMPLETED',result:await operation(source)});}
  catch(error){results.push({source_id:source.name,status:'FAILED',error_code:/^[A-Z_]+$/.test(error.message)?error.message:'SOURCE_SCAN_FAILED'});}
  finally{activeHosts.delete(host);}
 }}
 await Promise.all(Array.from({length:Math.min(concurrency,pending.length)},worker));return results;
}
export async function runParallelDiscovery({repository,concurrency=6,signal,observer=async()=>{},registryPath}={}){
 const sources=await loadMarketSources(registryPath);
 const health=new Map((await repository.pool.query('SELECT source_id,metadata FROM market_source_health')).rows.map(r=>[r.source_id,r.metadata]));
 const due=sources.filter(s=>s.enabled!==false&&(
  ['public_listing_html','public_headless_jobposting'].includes(s.adapter)&&health.get(s.name)?.listing_root_url!==s.url
  ||!(Date.parse(health.get(s.name)?.next_request_at)>Date.now())));
 const normalizationState=due.length?await createDiscoveryNormalizationState(repository):null;
 const results=await runSourcePool(due,source=>runMarketDiscovery({repository,sourceIds:[source.name],parallelSource:true,continuousPolling:true,signal,observer,registryPath,normalizationState}),{concurrency});
 return {configured:sources.length,due:due.length,waiting:sources.length-due.length,concurrency,results};
}
