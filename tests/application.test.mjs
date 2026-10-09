import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import { professionalYears, resolveField, runApplication, BrowserClient } from '../services/core/application.mjs';
import { Repository } from '../services/core/repository.mjs';
import { Telegram } from '../services/core/telegram.mjs';
import { createCv } from '../services/core/cv.mjs';
import { browserConfig, createBrowserService } from '../services/browser-service/server.mjs';
import { createMockBoard } from '../services/mock-job-board/server.mjs';
import { fixtureHumanCaptcha } from '../services/mock-job-board/test-human-adapter.mjs';
test('a past professional role is not invented as current employment',()=>{const profile={experience:[{provenance:'PROFESSIONAL',role:'IT Specialist'}]};assert.equal(resolveField({name:'current_title',label:'Current job title',type:'text'},{profile,job:{}}),null);assert.equal(resolveField({name:'current_title',label:'Current job title',type:'text'},{profile:{...profile,onboarding:{current_job_title:'Declared current role'}},job:{}}).value,'Declared current role');});

test('form answers preserve professional provenance and country-scoped user memory',()=>{
 const profile={candidate:{eu_citizen:true,base_location:{country:'Poland'}},onboarding:{legal_name:'Alex Example',email:'alex@example.invalid'},experience:[{provenance:'PROFESSIONAL',exact_start_date:'2024-01-01',exact_end_date:'2025-12-31'},{provenance:'PROFESSIONAL',exact_start_date:'2025-01-01',exact_end_date:'2025-12-31'},{provenance:'INDEPENDENT_R_AND_D',duration_approx_years:8}],skills:{software:['Python']}};
 assert.equal(professionalYears(profile),2);assert.equal(professionalYears({experience:[{provenance:'INDEPENDENT_R_AND_D',duration_approx_years:5}]}),undefined);
 const job={country:'PL'},field={name:'salary_expectation',label:'Expected salary',type:'text'},answerMemory={answers:[{key:'salary_expectation',value:'10000-12000',source:'USER',reusable:true,reuse_approved:true,scope:{country:'PL'}}]};
 assert.equal(resolveField(field,{profile,job,answerMemory}).source,'ANSWER_MEMORY');assert.equal(resolveField(field,{profile,job:{country:'DE'},answerMemory}),null);
 assert.equal(resolveField({name:'catia_professional_years',label:'Professional years of CATIA experience',type:'number'},{profile,job}),null);
 assert.equal(resolveField({name:'start_date',label:'Earliest available date',type:'date'},{profile,job}),null);
 assert.equal(resolveField({name:'first_name',label:'Given name',type:'text'},{profile:{...profile,onboarding:{legal_name:'Maria Teresa Garcia'}},job}),null);
 assert.equal(resolveField({name:'last_name',label:'Surname',type:'text'},{profile:{...profile,onboarding:{legal_name:'Maria Teresa Garcia'}},job}),null);
 assert.equal(professionalYears({...profile,experience:[...profile.experience,{provenance:'PROFESSIONAL',duration_approx_years:3}]}),undefined);
});

test('PostgreSQL and Chromium application runner pauses for correlated human answers, handles CAPTCHA and submits once', {skip:!process.env.DATABASE_URL,timeout:120000},async t=>{
 const repo=new Repository(),original=repo.pool,client=await original.connect(),schema='app_test_'+randomUUID().replaceAll('-','');await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema},public`);repo.pool={query:(...args)=>client.query(...args),connect:async()=>({query:(...args)=>client.query(...args),release(){}})};await repo.migrate();
 t.after(async()=>{await client.query(`DROP SCHEMA ${schema} CASCADE`);client.release();await original.end();});
 const board=createMockBoard({testMode:true,testToken:'fixture-test-human'});await board.listen();t.after(()=>board.close());
 const directory=await mkdtemp(path.join(os.tmpdir(),'jobhunter-application-')),config={...browserConfig({BROWSER_SERVICE_TOKEN:'fixture-application-browser',ALLOW_MOCK_NETWORK:'true',ALLOW_MOCK_SUBMIT:'true',ARTIFACT_DIR:directory,BROWSER_STATE_DIR:path.join(directory,'browser')}),port:0,fillAllFields:false};const service=await createBrowserService(config);await service.listen();t.after(()=>service.close());
 const browser=new BrowserClient({baseUrl:'http://127.0.0.1:'+service.server.address().port,token:config.token});
 const profile=YAML.parse(await readFile('tests/fixtures/candidate_profile_test.yaml','utf8'));profile.candidate.legal_name=profile.onboarding.legal_name;profile.onboarding.earliest_start_date='UNKNOWN';profile.onboarding.current_job_title=profile.experience.find(f=>f.provenance==='PROFESSIONAL')?.role;
 const jobId=randomUUID(),job={job_id:jobId,canonical_url:'http://127.0.0.1:3002/jobs/mechanical-engineer-42',application_url:'http://127.0.0.1:3002/apply/mechanical-engineer-42',company:'Fixture Engineering',title:'Mechanical R&D Engineer',country:'PL',availability_status:'OPEN'};
 await client.query('INSERT INTO jobs(job_id,canonical_url,application_url,company,title,country,description_text,availability_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[jobId,job.canonical_url,job.application_url,job.company,job.title,'PL','Fixture Fusion 360 prototyping role','OPEN']);await repo.saveAnalysis(jobId,{decision:'AUTO_APPLY',overall_fit:90,application_priority:90});
 await createCv({job,profile,analysis:{cv_focus_fact_ids:['exp_design','project_mech']},repository:repo,outputRoot:directory});
 let messageId=100;const telegram=new Telegram({token:'fixture-test-token',chatId:'123',fetchImpl:async()=>({ok:true,json:async()=>({ok:true,result:{message_id:++messageId}})})});
 const answerMemory={answers:['salary_expectation','work_arrangement','timezone_overlap','salary_format'].map((key,i)=>({key,value:['10000-12000','Remote','09:00-17:00 Europe/Warsaw','10000-12000 PLN'][i],source:'USER',reusable:true,reuse_approved:true,scope:{country:'PL'}}))};
 const options={repository:repo,jobId,profile,answerMemory,telegram,browser,config};
 let result=await runApplication(options);assert.equal(result.status,'NEEDS_USER',JSON.stringify(result));assert.equal(result.pending_question.field_name,'start_date');
 let question=(await client.query('SELECT * FROM application_questions WHERE application_id=$1 AND answered_at IS NULL',[result.application_id])).rows[0];
 await assert.rejects(telegram.accept(repo,{message:{chat:{id:999},text:'2026-11-01',reply_to_message:{message_id:Number(question.telegram_message_id)}}}),/Unauthorized/);
 await telegram.accept(repo,{message:{chat:{id:123},text:'2026-11-01',reply_to_message:{message_id:Number(question.telegram_message_id)}}});
 result=await runApplication({...options,applicationId:result.application_id});assert.equal(result.status,'CAPTCHA_WAIT',JSON.stringify(result));
 const answer=await fixtureHumanCaptcha({baseUrl:'http://127.0.0.1:3002',draftId:result.pending_question.draft_id,testToken:'fixture-test-human'});question=(await client.query('SELECT * FROM application_questions WHERE application_id=$1 AND answered_at IS NULL',[result.application_id])).rows[0];
 await assert.rejects(telegram.accept(repo,{message:{chat:{id:123},text:answer.code,reply_to_message:{message_id:Number(question.telegram_message_id)}}}),/APPLICATION_NOT_WAITING_FOR_ANSWER|SECURITY_QUESTION/);
 // Existing mock board's explicit human-test adapter supplies this fixture code.
 // Production Telegram/dashboard never accepts CAPTCHA/security challenge answers.
 await client.query("UPDATE application_questions SET answer=$1::jsonb,answer_source='MOCK_HUMAN_TEST_ADAPTER',answered_at=now() WHERE question_id=$2",[JSON.stringify(answer.code),question.question_id]);
 result=await runApplication({...options,applicationId:result.application_id});assert.equal(result.status,'SUBMITTED',JSON.stringify(result));assert.equal(board.submissions.size,1);
 const duplicate=await runApplication({...options,applicationId:result.application_id});assert.equal(duplicate.status,'SUBMITTED');assert.equal(board.submissions.size,1);assert.equal((await client.query('SELECT count(*)::int AS n FROM applications')).rows[0].n,1);
 assert.equal((await client.query('SELECT count(*)::int AS n FROM consents')).rows[0].n,1);assert.ok((await client.query("SELECT count(*)::int AS n FROM events WHERE event_type='STATE_SUBMITTED'")).rows[0].n===1);
 const interruptedId=randomUUID(),cvId=(await client.query('SELECT cv_id FROM cv_versions LIMIT 1')).rows[0].cv_id;await client.query("INSERT INTO applications(application_id,candidate_profile_id,job_id,cv_id,status) VALUES($1,'interrupted-fixture',$2,$3,'SUBMITTING')",[interruptedId,jobId,cvId]);const interrupted=await runApplication({...options,applicationId:interruptedId,profile:{...profile,profile_id:'interrupted-fixture'}});assert.equal(interrupted.status,'SUBMISSION_UNKNOWN');assert.equal(board.submissions.size,1);
 await client.query('UPDATE runtime_control SET paused=true');assert.equal((await runApplication(options)).status,'PAUSED');
});

test('conditional Other explanation derives only from one observed discovery choice',()=>{const p={onboarding:{},candidate:{}},f={type:'text',label:'If other, please specify below',required:false};assert.equal(resolveField(f,{profile:p,job:{},view:{fields:[f,{type:'radio',checked:true,label:'Job board',group_label:'How did you hear about this job?'}]}}).value,'Not applicable — selected Job board.');assert.equal(resolveField(f,{profile:p,job:{},view:{fields:[f,{type:'radio',checked:true,label:'Other',group_label:'How did you hear about this job?'}]}}),null);});
