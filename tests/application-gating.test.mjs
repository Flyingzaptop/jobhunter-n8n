import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Repository } from '../services/core/repository.mjs';
import { runApplication } from '../services/core/application.mjs';
import { browserConfig } from '../services/browser-service/server.mjs';

test('PostgreSQL concurrent final gates reserve one daily slot atomically; unverified uploads never Submit', {skip:!process.env.DATABASE_URL},async t=>{
 const admin=new Repository(),schema='gate_'+randomUUID().replaceAll('-','');await admin.pool.query(`CREATE SCHEMA ${schema}`);const url=new URL(process.env.DATABASE_URL);url.searchParams.set('options',`-csearch_path=${schema}`);const repository=new Repository(url.href);await repository.migrate();t.after(async()=>{await repository.close();await admin.pool.query(`DROP SCHEMA ${schema} CASCADE`);await admin.close();});
 const profile={profile_id:'gate-fixture',onboarding:{legal_name:'Alex Example',email:'alex@example.invalid'}};
 const config={...browserConfig({ALLOW_MOCK_NETWORK:'true',ALLOW_MOCK_SUBMIT:'true'}),maxApplicationsPerDay:1};
 const jobs=[];for(let i=0;i<3;i++){const id=randomUUID(),cvId=randomUUID();await repository.pool.query("INSERT INTO jobs(job_id,canonical_url,application_url,company,title,description_text,availability_status) VALUES($1,$2,$3,'Gate Fixture','Fixture Engineer','Explicit verified fixture','OPEN')",[id,`http://127.0.0.1:3002/jobs/${id}`,`http://127.0.0.1:3002/apply/${id}`]);await repository.saveAnalysis(id,{decision:'AUTO_APPLY',overall_fit:90,application_priority:90});await repository.pool.query('INSERT INTO cv_versions(cv_id,job_id,profile_version,template_version,model,pdf_path,html_path,sha256,qa_json,manifest_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[cvId,id,'test','test','test',`/fixture/cv-${i}.pdf`,'/fixture/cv.html',`hash${i}`,{pass:true},{}]);jobs.push({job_id:id,filename:`cv-${i}.pdf`,sha256:`hash${i}`});}
 const sessions=new Map();let calls=0;
 const snapshot=(id)=>{const job=sessions.get(id);return {url:`http://127.0.0.1:3002/apply/${job.job_id}`,title:'Fixture final review',text:`Alex Example alex@example.invalid Fixture Engineer ${job.filename}`,current_step:8,fingerprint:'fixture-final',fields:[],buttons:[{selector:'#final',text:'Submit application',final_submit:true,type:'button'}],uploaded_file_hashes:job.omitUpload?[]:[{sha256:job.sha256,filename:job.filename}]};};
 const browser={call:async(endpoint,body)=>{if(endpoint==='/sessions'){const job=jobs.find(job=>body.url.endsWith(job.job_id)),id=randomUUID();sessions.set(id,job);return {session_id:id,snapshot:snapshot(id)};}const id=endpoint.split('/')[2];if(endpoint.endsWith('/submit')){calls++;await new Promise(resolve=>setTimeout(resolve,30));return {...snapshot(id),status:'SUBMITTED',confirmation_id:'CONF-'+id,confirmation_evidence:'NETWORK_AND_PAGE'};}if(endpoint.endsWith('/snapshot'))return snapshot(id);return {closed:true};}};
 const options={repository,profile,config,browser,telegram:{},verifyOpen:async()=>true};
 const results=await Promise.all(jobs.slice(0,2).map(job=>runApplication({...options,jobId:job.job_id})));assert.equal(results.filter(result=>result.status==='SUBMITTED').length,1);assert.equal(results.filter(result=>result.submit_blocked_reason==='DAILY_LIMIT').length,1);assert.equal(calls,1);assert.equal((await repository.pool.query("SELECT count(*)::int n FROM applications WHERE status='SUBMITTED'")).rows[0].n,1);
 jobs[2].omitUpload=true;const forged=await runApplication({...options,jobId:jobs[2].job_id});assert.equal(forged.status,'MANUAL_TAKEOVER');assert.equal(forged.reason,'FINAL_REVIEW_NOT_VERIFIED');assert.equal(calls,1);
});
