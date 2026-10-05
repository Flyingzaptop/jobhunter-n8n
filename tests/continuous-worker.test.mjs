import test from 'node:test';
import assert from 'node:assert/strict';
import {createContinuousWorker,ContinuousStore,cvWorkKey,eligibleAnalysis,eligibleCvAnalysis,currentTailoredCv} from '../services/core/continuous-worker.mjs';
import {CV_V2_VERSION} from '../services/core/cv-v2.mjs';
import {PROMPT_VERSION} from '../services/core/fit.mjs';
import {canonicalAnalysisHash} from '../services/core/evidence-hash.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {Repository} from '../services/core/repository.mjs';
import {readFile} from 'node:fs/promises';
const profile={profile_id:'fixture',candidate:{base_location:{city:'Wroclaw',country:'Poland'}}};
const policy={work_location_policy:{no_relocation:true,required_base:{city:'Wroclaw',country:'Poland'}}};
const analysis={prompt_version:PROMPT_VERSION,decision:'STRETCH',overall_fit:50,profile_hash:createHash('sha256').update(JSON.stringify(profile)).digest('hex'),
 job_content_hash:'source-v1',policy_hash:createHash('sha256').update(JSON.stringify(policy)).digest('hex'),requirements:[{id:'r1'}],hard_blockers:[],
 work_format:{remote_allowed:false,office_location:'Wroclaw',office_country:'Poland'}};
const job={job_id:'00000000-0000-0000-0000-000000000001',content_hash:'source-v1',location:'Wroclaw',country:'Poland',work_mode:'ONSITE',availability_status:'OPEN',analysis_json:analysis};
test('previous fit prompt receipts cannot authorize fresh CV or preparation',()=>{
 assert.equal(eligibleAnalysis(job,analysis,profile,policy),true);
 assert.equal(eligibleAnalysis(job,{...analysis,prompt_version:'fit-analysis-v3.2-polish-boundaries'},profile,policy),false);
});
test('CV may be drafted while work format remains unresolved, but form preparation still requires compatible location',()=>{
 const uncertainJob={...job,work_mode:'UNKNOWN'};
 const uncertainAnalysis={...analysis,work_format:{remote_allowed:false},employment_eligibility:{work_from_poland_allowed:true}};
 assert.equal(eligibleCvAnalysis(uncertainJob,uncertainAnalysis,profile,policy),true);
 assert.equal(eligibleAnalysis(uncertainJob,uncertainAnalysis,profile,policy),false);
 assert.equal(eligibleCvAnalysis(uncertainJob,{...uncertainAnalysis,employment_eligibility:{work_from_poland_allowed:null}},profile,policy),false);
 assert.equal(eligibleCvAnalysis(uncertainJob,{...uncertainAnalysis,hard_blockers:['NONLOCAL_PRESENCE']},profile,policy),false);
});
function harness(overrides={}){const claims=new Map(),outcomes=[];let applied=[];
 const store={status:async()=>{},paused:async()=>false,acquireLane:async()=>async()=>{},cvCandidates:async()=>[job],
  preparationCandidates:async()=>[{job_id:job.job_id,cv_id:'cv1'}, {job_id:'second',cv_id:'cv2'}],
  claim:async key=>{if(claims.has(key))return false;claims.set(key,true);return true;},finish:async(key,status,code)=>outcomes.push({key,status,code})};
 const worker=createContinuousWorker({store,profile,policy,enabled:true,dryRun:true,allowRealSubmit:false,intervalMs:10,
  discovery:async()=>{},buildQueue:async()=>{},fit:async()=>{},cv:async()=>({}),notify:async()=>{},
  prepare:async(jobId)=>({application_id:jobId}),apply:async(jobId)=>{applied.push(jobId);return {status:jobId===job.job_id?'CAPTCHA_WAIT':'READY_STOP'};},...overrides});
 return {worker,store,claims,outcomes,applied};}

test('worker restart resumes the CV turn instead of repeatedly returning to fit',async()=>{
 let schedule={nextModel:'fit',proseTurn:false},fits=0,cvs=0;
 const attach=store=>{store.loadModelSchedule=async()=>structuredClone(schedule);store.saveModelSchedule=async state=>{schedule=structuredClone(state);};};
 const first=harness({fit:async()=>{fits++;},cv:async()=>{cvs++;return{status:'REGISTERED'};}});attach(first.store);
 await first.worker.tick('model');assert.equal(fits,1);assert.equal(schedule.nextModel,'cv');
 const restarted=harness({fit:async()=>{fits++;},cv:async()=>{cvs++;return{status:'REGISTERED'};}});attach(restarted.store);
 await restarted.worker.tick('model');assert.equal(fits,1);assert.equal(cvs,1);assert.equal(schedule.nextModel,'fit');
});
test('cheap screening processes arrivals while a slow source scan is still pending',async()=>{
 let finishScan,screened=0;
 const {worker}=harness({discovery:()=>new Promise(resolve=>{finishScan=resolve;}),buildQueue:async()=>{screened++;}});
 const ingestion=worker.tick('ingestion');await new Promise(resolve=>setImmediate(resolve));
 await worker.tick('screening');assert.equal(screened,1);
 finishScan();await ingestion;assert.equal(screened,1);
});
test('CAPTCHA waiting on one application does not block the next preparation worker',async()=>{
 const {worker,outcomes,applied}=harness();
 await Promise.all([worker.tick('preparation-1'),worker.tick('preparation-2')]);
 assert.deepEqual(applied.sort(),[job.job_id,'second'].sort());
 assert.equal(outcomes.length,2);assert.ok(outcomes.every(row=>row.status==='WAITING_USER'));
 await worker.tick('preparation-1');assert.equal(applied.length,2);
});
test('ingestion proceeds while model inference remains pending',async()=>{
 let release,discovered=0,queued=0;
 const {worker}=harness({fit:()=>new Promise(resolve=>{release=resolve;}),discovery:async()=>{discovered++;},buildQueue:async()=>{queued++;}});
 const pending=worker.tick('model');await new Promise(resolve=>setImmediate(resolve));
 await worker.tick('ingestion');assert.equal(discovered,1);assert.equal(queued,0);
 await worker.tick('screening');assert.equal(queued,1);
 release();await pending;
});
test('CV work deduplicates canonical analysis, source and current profile without inventing visual QA',async()=>{
 let generated=0;
 const {worker,outcomes}=harness({cv:async()=>{generated++;return {status:'DRAFT_PENDING_VISUAL'};}});
 for(let i=0;i<6;i++)await worker.tick('model');
 assert.equal(generated,1);assert.equal(outcomes[0].status,'DRAFT_PENDING_VISUAL');
 assert.equal(cvWorkKey(job,analysis,profile),cvWorkKey(job,{hard_blockers:[],requirements:analysis.requirements,...analysis},profile));
 assert.notEqual(cvWorkKey(job,analysis,profile),cvWorkKey({...job,content_hash:'v2'},analysis,profile));
 assert.equal(eligibleAnalysis(job,{...analysis,profile_hash:'stale'},profile),false);
 assert.equal(eligibleAnalysis(job,{...analysis,decision:'REJECT'},profile),false);
});
test('automatic independently registered CV finishes instead of remaining pending visual QA',async()=>{
 const {worker,outcomes}=harness({cv:async()=>({status:'REGISTERED'})});
 await worker.tick('model');await worker.tick('model');
 assert.equal(outcomes[0].status,'COMPLETED');assert.equal(outcomes[0].code,'REGISTERED');
});
test('current CV version changes dedup key and rejects previous generic artifacts',()=>{
 assert.notEqual(cvWorkKey(job,analysis,profile,'cv-factory-v2.1'),cvWorkKey(job,analysis,profile));
 const manifest={template_version:CV_V2_VERSION,qa:{tailoring:{pass:true}},job_content_hash:job.content_hash,analysis_hash:canonicalAnalysisHash(analysis)};
 assert.equal(currentTailoredCv(manifest,job,analysis),true);
 assert.equal(currentTailoredCv({...manifest,template_version:'cv-factory-v2.1'},job,analysis),false);
 assert.equal(currentTailoredCv({...manifest,qa:{}},job,analysis),false);
});
test('each tick reloads private configuration; new policy closes stale routes while pending fit keeps its snapshot',async()=>{
 let current={profile,policy},release,fitSnapshot,prepared=0;
 const {worker,store}=harness({loadConfiguration:async()=>current,fit:context=>{fitSnapshot=context;return new Promise(resolve=>{release=resolve;});},prepare:async()=>{prepared++;return {application_id:'a'};}});
 store.preparationCandidates=async(p,policy)=>eligibleAnalysis(job,analysis,p,policy)?[{job_id:job.job_id,cv_id:'cv'}]:[];
 const pending=worker.tick('model');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(eligibleAnalysis(job,analysis,profile,policy),true);
 current={profile,policy:{...policy,excluded_job_ids:[job.job_id]}};
 await worker.tick('preparation-1');assert.equal(prepared,0);
 assert.deepEqual(fitSnapshot.policy,policy);assert.notEqual(fitSnapshot.profile,profile);
 release();await pending;
 assert.equal(eligibleAnalysis({...job,location:'Cluj',country:'Romania'},{...analysis,work_format:{remote_allowed:false,office_location:'Cluj',office_country:'Romania'}},profile,policy),false);
});
test('remote from Poland may prepare in REVIEW with unknown hiring route when location policy is compatible',()=>{
 const remote={...job,work_mode:'REMOTE',location:'Remote, Poland',description_text:'Work remotely from Poland.'};
 const remoteAnalysis={...analysis,decision:'REVIEW',work_format:{remote_allowed:true,hybrid_required:false,remote_region:'Poland',work_from_poland_allowed:true,employment_route:'UNKNOWN'}};
 assert.equal(eligibleAnalysis(remote,remoteAnalysis,profile,policy),true);
});
test('worker requires explicit authorization and controlled dry run',()=>{
 assert.throws(()=>harness({enabled:false}),/AUTHORIZATION_REQUIRED/);
 assert.throws(()=>harness({dryRun:false}),/REQUIRES_DRY_RUN/);
 assert.throws(()=>harness({allowRealSubmit:true}),/REQUIRES_DRY_RUN/);
});
test('PostgreSQL work leases deduplicate concurrent claims and recover only expired running work',
 {skip:!process.env.DATABASE_URL},async()=>{
 const repo=new Repository(),client=await repo.pool.connect(),schema='worker_test_'+randomUUID().replaceAll('-','');
 try{await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema},public`);
  await client.query(await readFile('db/migrations/010_continuous_worker.sql','utf8'));
  const repository={pool:{query:(...args)=>client.query(...args)}};
  const one=new ContinuousStore(repository),two=new ContinuousStore(repository);
  assert.equal(await one.claim('fixture','preparation',job.job_id),true);
  assert.equal(await two.claim('fixture','preparation',job.job_id),false);
  await two.finish('fixture','COMPLETED','COMPLETED');
  assert.equal((await client.query("SELECT status FROM continuous_work WHERE work_key='fixture'")).rows[0].status,'RUNNING');
  await client.query("UPDATE continuous_work SET lease_until=now()-interval '1 second' WHERE work_key='fixture'");
  assert.equal(await two.claim('fixture','preparation',job.job_id),true);
  await two.finish('fixture','WAITING_USER','CAPTCHA_WAIT');
  assert.equal(await one.claim('fixture','preparation',job.job_id),false);
 }finally{await client.query(`DROP SCHEMA ${schema} CASCADE`);client.release();await repo.close();}
});

test('PostgreSQL CV selection cannot be starved by a thousand obsolete analyses',
 {skip:!process.env.DATABASE_URL},async()=>{
 const repo=new Repository(),client=await repo.pool.connect(),schema='cv_queue_'+randomUUID().replaceAll('-','');
 try{
  await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema},public`);
  await client.query('CREATE TABLE jobs(job_id uuid PRIMARY KEY,content_hash text,availability_status text,first_seen_at timestamptz,location text,country text,work_mode text)');
  await client.query('CREATE TABLE job_analysis(analysis_id uuid,job_id uuid,analysis_json jsonb,created_at timestamptz)');
  await client.query('CREATE TABLE cv_versions(job_id uuid,profile_version text,manifest_json jsonb)');
  await client.query("INSERT INTO jobs SELECT gen_random_uuid(),'old','OPEN',now()-interval '1 day',NULL,NULL,NULL FROM generate_series(1,1001)");
  await client.query("INSERT INTO job_analysis SELECT gen_random_uuid(),job_id,'{\"decision\":\"REJECT\"}'::jsonb,now() FROM jobs");
  await client.query("INSERT INTO jobs VALUES($1,$2,'OPEN',now(),$3,$4,$5)",[job.job_id,job.content_hash,job.location,job.country,job.work_mode]);
  await client.query('INSERT INTO job_analysis VALUES($1,$2,$3,now())',[randomUUID(),job.job_id,analysis]);
  const store=new ContinuousStore({pool:{query:(...args)=>client.query(...args)}});
  assert.deepEqual((await store.cvCandidates(profile,policy)).map(row=>row.job_id),[job.job_id]);
  const better=randomUUID();await client.query("INSERT INTO jobs VALUES($1,$2,'OPEN',now(),$3,$4,$5)",[better,job.content_hash,job.location,job.country,job.work_mode]);
  await client.query('INSERT INTO job_analysis VALUES($1,$2,$3,now())',[randomUUID(),better,{...analysis,overall_fit:85,application_priority:0}]);
  assert.deepEqual((await store.cvCandidates(profile,policy)).map(row=>row.job_id),[better,job.job_id]);
  await client.query('UPDATE jobs SET content_hash=$2 WHERE job_id=$1',[better,'changed-offer']);assert.deepEqual((await store.cvCandidates(profile,policy)).map(row=>row.job_id),[job.job_id]);
 }finally{await client.query(`DROP SCHEMA ${schema} CASCADE`);client.release();await repo.close();}
});
