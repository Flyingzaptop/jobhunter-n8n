import test from 'node:test';import assert from 'node:assert/strict';import{createHash,randomUUID}from'node:crypto';
import{mkdir,writeFile,rm}from'node:fs/promises';import path from'node:path';import pg from'pg';
import{Repository}from'../services/core/repository.mjs';import{canonicalAnalysisHash}from'../services/core/evidence-hash.mjs';
import{enqueueRegisteredCvDocuments,drainRegisteredCvDocuments,registeredCvCaption}from'../services/core/document-delivery.mjs';
const hash=value=>createHash('sha256').update(Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');

test('document caption preserves Russian text and sanitizes job fields without transport or file details',()=>{
 const caption=registeredCvCaption({company:'Компания\nПодмена',title:'Инженер-механик',job_id:'12345678-rest'},'https://example.com/#human-review');
 assert.match(caption,/Готовое CV/);assert.match(caption,/Компания Подмена/);assert.match(caption,/Инженер-механик/);assert.match(caption,/Вакансия 12345678/);assert.ok(!caption.includes('\uFFFD'));assert.ok(!caption.includes('sha256'));
});
test('isolated PostgreSQL registered CV outbox enforces profile/freshness/hash, UTF8, concurrent idempotence and unknown-delivery boundaries',{skip:!process.env.DATABASE_URL},async t=>{
 const repo=new Repository(),admin=repo.pool,schema='documents_test_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);repo.pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`,max:8});
 const root=path.resolve('data/cv-v2'),folder=path.resolve(root,'document-delivery-regression-'+randomUUID());
 assert.ok(!path.relative(root,folder).startsWith('..'));await mkdir(folder,{recursive:true});
 t.after(async()=>{await repo.pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await rm(folder,{recursive:true,force:true});});await repo.migrate();
 const profile={profile_id:'DOCUMENT_DELIVERY_REGRESSION_ONLY',identity:{name:'Regression Fixture'}};
 const bytes=Buffer.from('%PDF-1.7\nIsolated transport fixture, not a reviewed production document.\n%%EOF');
 async function seed({createdAt=new Date(),qaPass=true}={}){
  const jobId=randomUUID(),cvId=randomUUID(),analysisId=randomUUID(),pdfPath=path.join(folder,cvId+'.pdf');await writeFile(pdfPath,bytes);
  const sourceHash=hash('Isolated regression vacancy text');
  const analysis={decision:'REVIEW',overall_fit:70,profile_hash:hash(profile),job_content_hash:sourceHash,requirements:[{requirement:'Fixture requirement',match:'YES'}],hard_blockers:[]};
  await repo.pool.query("INSERT INTO jobs(job_id,canonical_url,company,title,description_text,content_hash,availability_status,metadata)VALUES($1,$2,'Регрессионная компания','Инженер-механик','Isolated regression vacancy text',$3,'OPEN',$4)",[jobId,'https://example.invalid/jobs/'+jobId,sourceHash,{profile:'mock'}]);
  await repo.pool.query("INSERT INTO job_analysis(analysis_id,job_id,model,prompt_version,profile_version,decision,overall_fit,analysis_json)VALUES($1,$2,'none','regression',$3,'REVIEW',70,$4)",[analysisId,jobId,hash(profile),analysis]);
  const qa={pass:qaPass,claims:{pass:true},identity:{pass:true},pdf:{pass:true,visual_review:{pass:qaPass}}};
  const manifest={profile_hash:hash(profile),job_content_hash:sourceHash,analysis_hash:canonicalAnalysisHash(analysis),application_eligible:true};
  await repo.pool.query('INSERT INTO cv_versions(cv_id,job_id,profile_version,template_version,model,pdf_path,html_path,sha256,qa_json,manifest_json,created_at)VALUES($1,$2,$3,\'regression\',\'none\',$4,\'not-used\',$5,$6,$7,$8)',[cvId,jobId,hash(profile),pdfPath,hash(bytes),qa,manifest,createdAt]);
  return{cvId,jobId,pdfPath,analysis};
 }
 const old=await seed({createdAt:new Date('2020-01-01')});
 const cutoff=new Date(Date.now()-1000);const fresh=await seed();
 const enqueued=await Promise.all([enqueueRegisteredCvDocuments({repo,profile,since:cutoff}),enqueueRegisteredCvDocuments({repo,profile,since:cutoff})]);
 assert.equal(enqueued.reduce((sum,r)=>sum+r.queued,0),1);
 assert.equal((await repo.pool.query('SELECT count(*)::int n FROM telegram_document_deliveries')).rows[0].n,1);
 assert.equal((await repo.pool.query('SELECT count(*)::int n FROM telegram_document_deliveries WHERE cv_id=$1',[old.cvId])).rows[0].n,0);
 assert.equal((await drainRegisteredCvDocuments({repo,profile,telegram:{}})).status,'WAITING_CONFIGURATION');
 let sends=0;const telegram={token:'12345:REGRESSION_FAKE_TOKEN',chatId:'123456',fetch:async(url,options)=>{
  sends++;assert.equal(new URL(url).origin,'https://api.telegram.org');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.body.get('chat_id'),'123456');
  const caption=options.body.get('caption');assert.match(caption,/Готовое CV/);assert.match(caption,/Регрессионная компания/);assert.match(caption,/Инженер-механик/);
  const document=options.body.get('document');assert.equal(document.type,'application/pdf');assert.deepEqual(Buffer.from(await document.arrayBuffer()),bytes);
  return new Response(JSON.stringify({ok:true,result:{message_id:101,chat:{id:123456,type:'private'},caption,document:{file_id:'REGRESSION_DOCUMENT'}}}),{status:200});
 }};
 const drained=await Promise.all([drainRegisteredCvDocuments({repo,profile,telegram}),drainRegisteredCvDocuments({repo,profile,telegram})]);
 assert.equal(sends,1);assert.equal(drained.reduce((sum,r)=>sum+r.sent,0),1);
 assert.equal((await repo.pool.query('SELECT status,telegram_message_id FROM telegram_document_deliveries WHERE cv_id=$1',[fresh.cvId])).rows[0].status,'SENT');
 await enqueueRegisteredCvDocuments({repo,profile,since:new Date('1900-01-01')});await drainRegisteredCvDocuments({repo,profile,telegram});assert.equal(sends,1);
 // Bytes modified after enqueue and latest analysis changed before send both fail closed.
 const altered=await seed();await enqueueRegisteredCvDocuments({repo,profile});await writeFile(altered.pdfPath,Buffer.from('%PDF-1.7\nChanged fixture bytes'));
 const stale=await seed();await enqueueRegisteredCvDocuments({repo,profile});
 await repo.pool.query("INSERT INTO job_analysis(analysis_id,job_id,model,prompt_version,profile_version,decision,overall_fit,analysis_json,created_at)VALUES($1,$2,'none','regression',$3,'REVIEW',70,$4,now()+interval '1 second')",[randomUUID(),stale.jobId,hash(profile),{...stale.analysis,requirements:[{requirement:'Changed fixture requirement',match:'YES'}]}]);
 const rejected=await drainRegisteredCvDocuments({repo,profile,telegram});assert.equal(rejected.results.filter(r=>r.status==='STALE').length,2);assert.equal(sends,1);
 const badBeforeEnqueue=await seed();await writeFile(badBeforeEnqueue.pdfPath,Buffer.from('%PDF-1.7\nAlready invalid bytes'));
 assert.equal((await enqueueRegisteredCvDocuments({repo,profile})).blocked,1);
 const unapproved=await seed({qaPass:false});assert.equal((await enqueueRegisteredCvDocuments({repo,profile})).queued,0);
 assert.equal((await repo.pool.query('SELECT count(*)::int n FROM telegram_document_deliveries WHERE cv_id=$1',[unapproved.cvId])).rows[0].n,0);
 const ambiguous=await seed();await enqueueRegisteredCvDocuments({repo,profile});
 let ambiguousSends=0;const unknownTelegram={...telegram,fetch:async()=>{ambiguousSends++;throw new Error('fixture network timeout');}};
 const unknown=await drainRegisteredCvDocuments({repo,profile,telegram:unknownTelegram});assert.equal(unknown.results[0].status,'DELIVERY_UNKNOWN');
 await drainRegisteredCvDocuments({repo,profile,telegram:unknownTelegram});assert.equal(ambiguousSends,1);
 assert.equal((await repo.pool.query('SELECT status FROM telegram_document_deliveries WHERE cv_id=$1',[ambiguous.cvId])).rows[0].status,'DELIVERY_UNKNOWN');
 const group=await seed();await enqueueRegisteredCvDocuments({repo,profile});assert.equal((await drainRegisteredCvDocuments({repo,profile,telegram:{...telegram,chatId:'-12345'}})).error_code,'PRIVATE_TELEGRAM_CHAT_REQUIRED');assert.equal(sends,1);
 // A changed profile cannot drain old private CV rows.
 await drainRegisteredCvDocuments({repo,profile:{...profile,newFact:true},telegram});assert.equal(sends,1);
 assert.equal((await repo.pool.query('SELECT status FROM telegram_document_deliveries WHERE cv_id=$1',[group.cvId])).rows[0].status,'STALE');
});
