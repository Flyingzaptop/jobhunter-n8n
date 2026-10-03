import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import YAML from 'yaml';
import {Repository} from './repository.mjs';
import {discoverSources} from './discovery.mjs';
import {normalizeRawRecords} from './normalization.mjs';
import {analyzeJob} from './fit.mjs';
import {OllamaClient} from './llm.mjs';
import {createCv} from './cv.mjs';
import {report} from './reporting.mjs';
import {Telegram} from './telegram.mjs';
const load=async p=>YAML.parse(await readFile(p,'utf8'));
const secretEqual=(a,b)=>{const x=Buffer.from(a??''),y=Buffer.from(b??'');return x.length===y.length&&x.length>0&&timingSafeEqual(x,y);};
export function createCore({repository=new Repository(),token=process.env.CORE_SERVICE_TOKEN,host=process.env.HOST??'127.0.0.1',port=3000,configDir='config',testProfilePath=null,testMode=false}={}){
 if(!token)throw new Error('CORE_SERVICE_TOKEN required');const telegram=new Telegram();const llm=new OllamaClient();
 async function stage(number,body={}){
  if(number===1){if(body.fixture){if(!testMode)throw new Error('Fixtures forbidden in production');const {fixtureRecords}=await import('../../tests/fixtures/discovery-helper.mjs');const records=await fixtureRecords();const ids=[];for(const record of records)ids.push((await repository.insertRaw(record)).raw_id);return {raw_ids:ids,discovered:ids.length,errors:[]};}const registry=await load(`${configDir}/source_registry.yaml`);const sources=registry.sources.filter(s=>(s.profile??'real')==='real').map(s=>({...registry.defaults,...s}));return discoverSources({sources,repository});}
  if(number===2)return normalizeRawRecords({records:await repository.listRaw(),repository});
  if(number===3){const profile=await load(testProfilePath??`${configDir}/candidate_profile.yaml`);const policy=await load(`${configDir}/search_policy.yaml`);const jobs=await repository.listCanonicalJobs();const results=[];for(const job of jobs){const exists=(await repository.pool.query('SELECT 1 FROM job_analysis WHERE job_id=$1 LIMIT 1',[job.job_id])).rowCount;if(exists&&!body.reanalyze)continue;try{const analysis=await analyzeJob({job,profile,policy,llm});analysis.model=llm.model;await repository.saveAnalysis(job.job_id,analysis);results.push({job_id:job.job_id,decision:analysis.decision,overall_fit:analysis.overall_fit});}catch(e){await repository.event('job',job.job_id,'ANALYSIS_FAILED',{error:e.name});results.push({job_id:job.job_id,error:e.name});}}return {analyzed:results.length,results};}
  if(number===4){if(!body.job_id)throw new Error('job_id required for CV generation');const profile=await load(testProfilePath??`${configDir}/candidate_profile.yaml`);const job=(await repository.listCanonicalJobs()).find(j=>j.job_id===body.job_id);if(!job)throw new Error('Job missing');const {rows}=await repository.pool.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[job.job_id]);if(!rows[0])throw new Error('Job analysis missing');return createCv({job,profile,analysis:rows[0].analysis_json,repository});}
  if(number===5){throw new Error('Application orchestration integration pending; no application started');}
  if(number===6)return report(repository,{telegram:process.env.TELEGRAM_BOT_TOKEN?telegram:undefined});
  throw new Error('Unknown stage');
 }
 const server=http.createServer(async(req,res)=>{const runId=randomUUID();const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({run_id:runId,...data}));};
  try{if(req.method==='GET'&&req.url==='/health'){await repository.pool.query('SELECT 1');return send(200,{ok:true,service:'core'});}
   if(!secretEqual(req.headers['x-jobhunter-token'],token))return send(401,{error:'Unauthorized'});
   let text='';for await(const chunk of req){text+=chunk;if(text.length>100000)throw new Error('Request too large');}const body=text?JSON.parse(text):{};
   if(req.method==='POST'&&/^\/stages\/[1-6]$/.test(req.url)){const result=await stage(Number(req.url.at(-1)),body);return send(200,{ok:true,result});}
   if(req.method==='POST'&&req.url==='/telegram/update')return send(200,{ok:true,result:await telegram.accept(repository,body)});
   return send(404,{error:'Not found'});
  }catch(e){console.error(JSON.stringify({run_id:runId,event:'request_failed',error:e.name,message:e.message}));send(400,{ok:false,error:e.message});}
 });return {server,stage,repository,async start(){await repository.migrate();return new Promise(resolve=>server.listen(port,host,resolve));},async stop(){await new Promise(r=>server.close(r));await repository.close();}};
}
if(import.meta.url===new URL(process.argv[1],'file:///').href||process.argv[1]?.replaceAll('\\','/').endsWith('/services/core/server.mjs')){const core=createCore();await core.start();console.log('JobHunter core listening on port 3000');}
