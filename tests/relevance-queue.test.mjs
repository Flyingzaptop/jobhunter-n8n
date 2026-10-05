import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {Repository} from '../services/core/repository.mjs';
import {screenRelevance,fitInputHash,buildRelevanceQueue,runRelevanceFitBatch,compareCalibrationLabel,verificationRetryPlan,availabilityVerificationDue,RELEVANCE_LOCATION_ORDER_SQL,RELEVANCE_VERSION} from '../services/core/relevance-queue.mjs';

test('actual queue SQL gives compatible remote and local engineering equal geography tier ahead of unknown remote',{skip:!process.env.DATABASE_URL},async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
 try{
  const rows=(await pool.query(`SELECT name,${RELEVANCE_LOCATION_ORDER_SQL} AS tier FROM
   (VALUES ('hybrid','MECHANICAL_WROCLAW_HYBRID_HINT',90),('local','MECHANICAL_WROCLAW_HINT',97),
    ('worldwide','REMOTE_COMPATIBLE_REGION_HINT',99),('eu','REMOTE_COMPATIBLE_REGION_HINT',95),
    ('unknown','REMOTE_ELIGIBILITY_UNKNOWN',100)) AS q(name,location_class,relevance_score)
   ORDER BY ${RELEVANCE_LOCATION_ORDER_SQL},q.relevance_score DESC`)).rows;
  assert.deepEqual(rows.map(row=>row.name),['hybrid','worldwide','local','eu','unknown']);
  assert.equal(rows.find(row=>row.name==='eu').tier,rows.find(row=>row.name==='worldwide').tier);
 }finally{await pool.end();}
});
const now=new Date('2026-10-04T12:00:00Z');
test('incremental SQL screen preserves Unicode hashes, excludes unused metadata and rereads only changed input',{skip:!process.env.DATABASE_URL},async t=>{
 const repo=new Repository(),admin=repo.pool,schema='incremental_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);repo.pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
 t.after(async()=>{await repo.pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});await repo.migrate();const id=randomUUID();
 await repo.pool.query('INSERT INTO jobs(job_id,canonical_url,company,title,description_text,metadata)VALUES($1,$2,$3,$4,$5,$6)',[id,'https://fixture.invalid/job','Test "company"','Junior Mechanical Engineer','Wrocław\nCAD "design"; zażółć gęślą jaźń',{profile:'real',unused:'x'.repeat(10000)}]);
 const first=await repo.listRelevanceChanges('new');assert.equal(first.length,1);assert.equal(first[0].metadata,undefined);
 assert.equal((await buildRelevanceQueue({repository:repo})).counts.QUEUED,1);
 const again=await buildRelevanceQueue({repository:repo});assert.equal(again.changed_inputs,0);assert.equal(again.total,1);assert.equal(again.counts.QUEUED,1);
 await repo.pool.query("UPDATE jobs SET work_mode='REMOTE' WHERE job_id=$1",[id]);assert.equal((await repo.listRelevanceChanges(RELEVANCE_VERSION)).length,1);
 await buildRelevanceQueue({repository:repo});assert.equal((await repo.listRelevanceChanges(RELEVANCE_VERSION)).length,0);
});
test('cheap screening selects technical junior roles without fake fit/eligibility and deprioritizes incidental body keywords',()=>{
 const technical=screenRelevance({title:'Junior Mechanical Design Engineer',location:'Poland',country:'PL',description_text:'CAD prototyping',availability_status:'OPEN'},{now});
 const clerk=screenRelevance({title:'Senior Accounting Clerk',description_text:'Our robotics company uses Python and automation',country:'US',availability_status:'OPEN'},{now});
 assert.equal(technical.status,'QUEUED');assert.equal(technical.decision,null);assert.equal(technical.employment_eligibility,'UNKNOWN');assert.equal(technical.is_fit_analysis,false);
 assert.equal(clerk.status,'LOW_PRIORITY');assert.ok(technical.relevance_score>clerk.relevance_score);assert.ok(technical.reasons.some(r=>r.signal==='JUNIOR_STUDENT_TITLE'));
});
test('technical product-support bridge roles are queued from source troubleshooting evidence without generic retail support inference',()=>{
 const technical=screenRelevance({title:'Product Support Specialist',location:'Europe',description_text:'Experience troubleshooting technical issues, including APIs and integration setups.',availability_status:'OPEN'},{now});
 const retail=screenRelevance({title:'Product Support Associate',location:'Europe',description_text:'Retail returns and orders.',availability_status:'OPEN'},{now});
 assert.equal(technical.status,'QUEUED');assert.equal(technical.is_fit_analysis,false);assert.ok(technical.role_hints.includes('it_support'));assert.equal(retail.status,'LOW_PRIORITY');
});
test('remote unknown geography remains unknown and changed facts/model/policy/prompt invalidate fit receipt hash',()=>{
 const job={title:'Python Engineer',description_text:'Scientific tools',work_mode:'REMOTE',availability_status:'OPEN'};
 const q=screenRelevance(job,{now});assert.equal(q.location_class,'REMOTE_ELIGIBILITY_UNKNOWN');assert.equal(q.employment_eligibility,'UNKNOWN');
 const base={job,profile:{facts:['a']},policy:{threshold:78},model:'qwen3.5:4b'};const a=fitInputHash(base);
 for(const other of [{...base,profile:{facts:['b']}},{...base,policy:{threshold:79}},{...base,model:'other'},{...base,promptVersion:'next'},{...base,job:{...job,description_text:'Changed'}}])assert.notEqual(a,fitInputHash(other));
 assert.equal(screenRelevance({...job,availability_status:'CLOSED'},{now}).status,'CLOSED');
});
test('remote geography is equally prioritized worldwide and local mechanical hybrid receives slight preference',()=>{
 const base={title:'Mechanical Engineer',description_text:'Design mechanical systems',work_mode:'REMOTE',availability_status:'OPEN'};
 const us=screenRelevance({...base,country:'US',location:'United States'},{now});
 const eu=screenRelevance({...base,country:'DE',location:'Germany'},{now});
 const world=screenRelevance({...base,location:'Worldwide'},{now});
 assert.equal(us.relevance_score,eu.relevance_score);assert.equal(us.relevance_score,world.relevance_score);
 assert.equal(us.status,'QUEUED');assert.equal(us.employment_eligibility,'UNKNOWN');
 assert.ok(!us.reasons.some(reason=>reason.signal==='NON_EUROPE_DEPRIORITIZED'));
 const local=screenRelevance({...base,work_mode:'ONSITE',location:'Wrocław',country:'PL'},{now});
 const hybrid=screenRelevance({...base,work_mode:'HYBRID',location:'Wrocław',country:'PL'},{now});
 assert.equal(hybrid.relevance_score-local.relevance_score,3);
 assert.equal(hybrid.location_class,'MECHANICAL_WROCLAW_HYBRID_HINT');
 const other=screenRelevance({title:'Customer Care Associate',work_mode:'REMOTE',country:'US',availability_status:'OPEN'},{now});
 assert.equal(other.status,'LOW_PRIORITY');assert.equal(other.employment_eligibility,'UNKNOWN');
});
test('manual reference comparison exposes extraction gaps and false-positive/hard-blocker risks without rewriting analyses',()=>{
 const label={source_quote:'Completed degree required.',category:'EDUCATION',importance:'MANDATORY',candidate_match:'NO'};
 const analysis={requirements:[{source_quote:label.source_quote,match:'YES',category:'EDUCATION',importance:'MANDATORY',strict:true}]};const before=structuredClone(analysis);
 assert.ok(compareCalibrationLabel(label,analysis).error_signals.includes('UNSUPPORTED_POSITIVE_MATCH_RISK'));assert.deepEqual(analysis,before);
 assert.equal(compareCalibrationLabel(label,{requirements:[]}).status,'EXACT_REQUIREMENT_NOT_MAPPED');
 const falseBlock=compareCalibrationLabel({...label,candidate_match:'YES'},{requirements:[{...analysis.requirements[0],match:'NO'}]});
 assert.ok(falseBlock.error_signals.includes('FALSE_HARD_BLOCKER_RISK'));
});
test('salary amounts and missing salary do not filter or penalize discovery relevance',()=>{
 const job={title:'Mechanical Engineer',work_mode:'REMOTE',country:'DE',availability_status:'OPEN'};
 const low=screenRelevance({...job,salary:{min:1,max:2,currency:'PLN'}},{now});
 const high=screenRelevance({...job,salary:{min:100000,max:200000,currency:'PLN'}},{now});
 const missing=screenRelevance(job,{now});
 assert.equal(low.relevance_score,high.relevance_score);assert.equal(low.relevance_score,missing.relevance_score);
 assert.equal(low.status,'QUEUED');assert.equal(low.status,missing.status);
});
test('availability verification retries network failure after at least five minutes, checks unsupported/challenge states daily and closes explicit expiry',()=>{
 const retry=verificationRetryPlan({status:'UNKNOWN',reason:'BROWSER_TRANSPORT_ERROR'},1,{now});
 assert.equal(retry.status,'RETRY');assert.equal(Date.parse(retry.next_retry_at)-now.getTime(),300000);
 const challenge=verificationRetryPlan({status:'UNKNOWN',reason:'SOURCE_HTTP_403'},1,{now});assert.equal(challenge.status,'OPEN_UNVERIFIED');assert.equal(Date.parse(challenge.next_retry_at)-now.getTime(),86400000);
 assert.equal(verificationRetryPlan({status:'CLOSED'},1,{now}).next_retry_at,null);
 assert.equal(availabilityVerificationDue({last_verified_open_at:'2026-10-04T11:00:00Z'},{now}),false);
 assert.equal(availabilityVerificationDue({last_verified_open_at:'2026-10-02T11:00:00Z'},{now}),true);
});
test('real PostgreSQL queue resumes unique analyses, skips unchanged receipts and separates transient/semantic failures',{skip:!process.env.DATABASE_URL},async t=>{
 const repo=new Repository(),admin=repo.pool,schema='relevance_test_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 repo.pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`,max:8});
 t.after(async()=>{await repo.pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});await repo.migrate();
 const ids=[];for(let i=0;i<3;i++){const id=randomUUID();ids.push(id);await repo.pool.query(`INSERT INTO jobs(job_id,canonical_url,company,title,country,description_text,availability_status,metadata)
 VALUES($1,$2,'Regression Employer',$3,'PL','Actual regression text only','OPEN',$4)`,[id,'https://example.invalid/'+id,['Junior Mechanical Engineer','Python Engineer','IT Support'][i],{profile:'real'}]);}
 assert.equal((await buildRelevanceQueue({repository:repo})).counts.QUEUED,3);
 let calls=0;const analyzer=async()=>{calls++;return{decision:'REVIEW',overall_fit:70,role_family:'mechanical_engineering',career_alignment:'HIGH',work_format_class:'UNKNOWN'};};
 const options={repository:repo,profile:{profile_id:'fixture'},policy:{},llm:{model:'regression'},regressionMode:true,maxJobs:1,analyzer,verifier:async({job})=>({status:'OPEN',job}),observer:async()=>{}};
 assert.equal((await runRelevanceFitBatch(options)).analyzed,1);assert.equal(calls,1);
 assert.equal((await runRelevanceFitBatch({...options,maxJobs:3})).analyzed,2);assert.equal(calls,3);
 assert.equal((await runRelevanceFitBatch({...options,maxJobs:3})).attempted,0);assert.equal(calls,3);
 assert.equal((await runRelevanceFitBatch({...options,profile:{profile_id:'fixture',new_fact:true},maxJobs:1})).analyzed,1);assert.equal(calls,4);
 assert.equal((await repo.pool.query('SELECT count(*)::int n FROM fit_batch_receipts')).rows[0].n,4);
 const failingProfile={profile_id:'fixture-failing'};
 const failure=await runRelevanceFitBatch({...options,profile:failingProfile,analyzer:async()=>{throw new TypeError('Cannot read properties of undefined');}});
 assert.equal(failure.results[0].status,'DEAD_LETTER');
 const retry=await runRelevanceFitBatch({...options,profile:{profile_id:'fixture-network'},analyzer:async()=>{throw new TypeError('fetch failed');}});
 assert.equal(retry.results[0].status,'RETRY');
 assert.ok(retry.results[0].retry_at);assert.equal((await repo.pool.query("SELECT count(*)::int n FROM operation_runs WHERE mode='MOCK'")).rows[0].n,6);
 await repo.pool.query("UPDATE jobs SET last_verified_open_at=now()-interval '2 days' WHERE job_id=$1",[ids[2]]);
 let verificationCalls=0;const availabilityOptions={...options,jobIds:[ids[2]],analyzer:async()=>{throw new Error('Unchanged receipt must not invoke analyzer');},verifier:async({job})=>{verificationCalls++;return{status:'OPEN',job};}};
 const unchanged=await runRelevanceFitBatch(availabilityOptions);assert.equal(unchanged.inference_attempted,0);assert.equal(unchanged.availability_reverified,1);assert.equal(verificationCalls,1);
 await repo.pool.query("UPDATE jobs SET last_verified_open_at=now()-interval '2 days' WHERE job_id=$1",[ids[2]]);
 const verificationFailure=await runRelevanceFitBatch({...availabilityOptions,verifier:async()=>({status:'UNKNOWN',reason:'BROWSER_TRANSPORT_ERROR'})});
 assert.equal(verificationFailure.results[0].status,'RETRY');assert.ok(Date.parse(verificationFailure.results[0].retry_at)-Date.now()>290000);
 assert.equal((await runRelevanceFitBatch(availabilityOptions)).attempted,0);
 await repo.pool.query("UPDATE relevance_queue SET next_retry_at=now()-interval '1 second' WHERE job_id=$1",[ids[2]]);
 assert.equal((await runRelevanceFitBatch(availabilityOptions)).availability_reverified,1);assert.equal(verificationCalls,2);
 await assert.rejects(runRelevanceFitBatch({...options,regressionMode:false}),/BATCH_INFERENCE_AUTHORIZATION_REQUIRED/);
});
test('explicit nonlocal presence rejects before verifier/model with durable proof and no inference receipt',{skip:!process.env.DATABASE_URL},async t=>{
 const repo=new Repository(),admin=repo.pool,schema='hard_gate_test_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 repo.pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`,max:8});
 t.after(async()=>{await repo.pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});await repo.migrate();
 const id=randomUUID();await repo.pool.query("INSERT INTO jobs(job_id,canonical_url,company,title,location,country,work_mode,description_text,content_hash,availability_status,metadata)VALUES($1,$2,'Regression Employer','Junior Mechanical Engineer','Warsaw, Poland','PL','HYBRID',$3,'regression-source','OPEN',$4)",[id,'https://example.invalid/'+id,'Note: This will be a hybrid onsite internship position.',{profile:'real'}]);
 await buildRelevanceQueue({repository:repo});let modelCalls=0,verificationCalls=0;
 const options={repository:repo,profile:{profile_id:'hard-gate-fixture',candidate:{base_location:{city:'Wroclaw',country:'Poland'}}},policy:{work_location_policy:{required_base:{city:'Wroclaw',country:'Poland'},no_relocation:true}},llm:{model:'MUST_NOT_BE_USED'},regressionMode:true,maxJobs:1,observer:async()=>{},analyzer:async()=>{modelCalls++;throw new Error('Forbidden inference');},verifier:async()=>{verificationCalls++;throw new Error('Forbidden verification');}};
 const first=await runRelevanceFitBatch(options);assert.equal(first.deterministic_rejected,1);assert.equal(first.inference_attempted,0);assert.equal(first.analyzed,0);assert.equal(modelCalls,0);assert.equal(verificationCalls,0);
 assert.equal((await repo.pool.query('SELECT count(*)::int n FROM fit_batch_receipts')).rows[0].n,0);
 const saved=(await repo.pool.query('SELECT model,analysis_json FROM job_analysis')).rows[0];assert.equal(saved.model,'NO_MODEL_DETERMINISTIC');assert.equal(saved.analysis_json.model,null);assert.equal(saved.analysis_json.analysis_method,'DETERMINISTIC_HARD_GATE');assert.ok(saved.analysis_json.hard_reject_proof[0].policy_source);
 assert.equal((await runRelevanceFitBatch(options)).attempted,0);assert.equal((await repo.pool.query('SELECT count(*)::int n FROM job_analysis')).rows[0].n,1);
});
