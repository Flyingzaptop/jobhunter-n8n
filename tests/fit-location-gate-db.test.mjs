import test from 'node:test';import assert from 'node:assert/strict';import {createHash,randomUUID} from 'node:crypto';import pg from 'pg';
import {Repository} from '../services/core/repository.mjs';import {auditUnresolvedFitLocations} from '../services/core/fit-location-audit.mjs';import {llmTaskReport} from '../services/core/llm-tasks.mjs';
import {startFrozenBatch,batchProgress} from '../services/core/pipeline-batch.mjs';import {validationCandidates} from '../services/core/source-validation.mjs';import {PROMPT_VERSION} from '../services/core/fit.mjs';import {RELEVANCE_VERSION} from '../services/core/relevance-queue.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
test('Postgres: incomplete geography is not accepted or complete, and can be verified before any CV exists',{skip:!process.env.DATABASE_URL},async t=>{
 const repo=new Repository(),admin=repo.pool,schema='fit_geo_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);repo.pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`,max:4});t.after(async()=>{await repo.pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});await repo.migrate();
 const profile={profile_id:'fixture',candidate:{base_location:{city:'Wroclaw',country:'Poland'}}},policy={};
 for(const decision of ['REVIEW','REJECT']){const id=randomUUID(),analysis={decision,overall_fit:95,prompt_version:PROMPT_VERSION,analysis_method:'GEMMA_SINGLE_SCORE',profile_hash:hash(profile),policy_hash:hash(policy),job_content_hash:'h',location_policy_status:'UNVERIFIED',work_format:{},requirements:[{}],hard_blockers:[]};
  await repo.pool.query("INSERT INTO jobs(job_id,canonical_url,company,title,description_text,content_hash,availability_status)VALUES($1,$2,'Fixture','Fixture role','Fixture only','h','OPEN')",[id,'https://example.invalid/'+id]);
  await repo.pool.query("INSERT INTO job_analysis(analysis_id,job_id,model,prompt_version,profile_version,overall_fit,decision,analysis_json)VALUES($1,$2,'fixture',$3,'fixture',95,$4,$5)",[randomUUID(),id,PROMPT_VERSION,decision,analysis]);
  await repo.pool.query("INSERT INTO relevance_queue(job_id,relevance_version,input_hash,relevance_score,status,location_class,seniority_class)VALUES($1,$2,'h',95,'ANALYZED','UNKNOWN','UNKNOWN')",[id,RELEVANCE_VERSION]);
 }
 assert.equal((await auditUnresolvedFitLocations(repo,{profile,policy})).location_pending,1);
 const report=await llmTaskReport({repository:repo,profile,policy});assert.equal(report.fit.accepted,0);assert.equal(report.fit.rejected,1);assert.equal(report.funnel.location_pending,1);assert.equal(report.funnel.llm_done,1);
 await startFrozenBatch(repo);const batch=await batchProgress(repo,profile,policy);assert.equal(batch.fit.done,1);assert.equal(batch.fit.exceptions,1);assert.equal(batch.cv.total,0);
 assert.equal((await validationCandidates(repo,profile,policy)).length,1);
});
