import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {Repository} from '../services/core/repository.mjs';
import {screenRelevance,fitInputHash,buildRelevanceQueue,runRelevanceFitBatch,compareCalibrationLabel} from '../services/core/relevance-queue.mjs';
const now=new Date('2026-10-04T12:00:00Z');
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
 const q=screenRelevance(job,{now});assert.equal(q.location_class,'UNKNOWN');assert.equal(q.employment_eligibility,'UNKNOWN');
 const base={job,profile:{facts:['a']},policy:{threshold:78},model:'qwen3.5:4b'};const a=fitInputHash(base);
 for(const other of [{...base,profile:{facts:['b']}},{...base,policy:{threshold:79}},{...base,model:'other'},{...base,promptVersion:'next'},{...base,job:{...job,description_text:'Changed'}}])assert.notEqual(a,fitInputHash(other));
 assert.equal(screenRelevance({...job,availability_status:'CLOSED'},{now}).status,'CLOSED');
});
test('manual reference comparison exposes extraction gaps and false-positive/hard-blocker risks without rewriting analyses',()=>{
 const label={source_quote:'Completed degree required.',category:'EDUCATION',importance:'MANDATORY',candidate_match:'NO'};
 const analysis={requirements:[{source_quote:label.source_quote,match:'YES',category:'EDUCATION',importance:'MANDATORY',strict:true}]};const before=structuredClone(analysis);
 assert.ok(compareCalibrationLabel(label,analysis).error_signals.includes('UNSUPPORTED_POSITIVE_MATCH_RISK'));assert.deepEqual(analysis,before);
 assert.equal(compareCalibrationLabel(label,{requirements:[]}).status,'EXACT_REQUIREMENT_NOT_MAPPED');
 const falseBlock=compareCalibrationLabel({...label,candidate_match:'YES'},{requirements:[{...analysis.requirements[0],match:'NO'}]});
 assert.ok(falseBlock.error_signals.includes('FALSE_HARD_BLOCKER_RISK'));
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
 await assert.rejects(runRelevanceFitBatch({...options,regressionMode:false}),/BATCH_INFERENCE_AUTHORIZATION_REQUIRED/);
});
