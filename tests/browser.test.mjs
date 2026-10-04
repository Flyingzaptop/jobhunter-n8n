import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { browserConfig, createBrowserService } from '../services/browser-service/server.mjs';
import { validateDestination, privateAddress, submitPermission, classifyConsent } from '../services/browser-service/policy.mjs';
import { createMockBoard, vacancies } from '../services/mock-job-board/server.mjs';
import { fixtureHumanCaptcha } from '../services/mock-job-board/test-human-adapter.mjs';

test('browser network policy rejects private IPv4, IPv6, redirects and unsafe schemes; only exact mock destination allowed', async () => {
  const config = browserConfig({});
  for (const ip of ['127.0.0.1','10.0.0.1','172.16.1.1','169.254.169.254','192.168.2.4','100.64.0.1','::1','::ffff:7f00:1','fc00::1','fe80::1']) assert.equal(privateAddress(ip),true,ip);
  assert.equal(privateAddress('8.8.8.8'),false); assert.equal(privateAddress('2606:4700:4700::1111'),false);
  for (const url of ['file:///C:/secret','javascript:alert(1)','http://127.1','http://[::1]','http://user:password@example.com']) await assert.rejects(validateDestination(url,config));
  await assert.rejects(validateDestination('https://rebind.example', config, async()=>[{address:'8.8.8.8',family:4},{address:'10.1.1.1',family:4}]));
  const mock = browserConfig({ALLOW_MOCK_NETWORK:'true'}); assert.equal((await validateDestination('http://127.0.0.1:3002/jobs',mock)).mock,true);
  await assert.rejects(validateDestination('http://127.0.0.1:3001/jobs',mock));
  await assert.rejects(validateDestination('http://192.168.1.1:3002/jobs',mock));
  await assert.rejects(validateDestination('http://mock-job-board:3002/jobs',mock,async()=>[{address:'8.8.8.8',family:4}]),/MOCK_DESTINATION_MUST_BE_LOCAL/);
});

test('submit gating and consent classification fail closed', () => {
  const base = browserConfig({ ALLOW_MOCK_NETWORK:'true', ALLOW_MOCK_SUBMIT:'true' });
  assert.equal(submitPermission('http://127.0.0.1:3002/apply/1',base),null);
  assert.equal(submitPermission('https://employer.example/apply',base),'DRY_RUN');
  assert.equal(submitPermission('http://public.example:3002/apply',{...base,mockHosts:['public.example']}),'DRY_RUN');
  assert.equal(submitPermission('https://employer.example/apply',{...base,dryRun:false,allowRealSubmit:true}),'DOMAIN_NOT_ALLOWED');
  assert.equal(submitPermission('https://employer.example/apply',{...base,dryRun:false,allowRealSubmit:true,allowDomains:['employer.example']}),null);
  assert.equal(submitPermission('http://127.0.0.1:3002/apply/1',{...base,enabled:false}),'PAUSED');
  assert.equal(classifyConsent('Privacy notice for current recruitment',true).consent_type,'RECRUITMENT_TECHNICAL');
  assert.equal(classifyConsent('Privacy notice and transfer data to third parties',true).consent_type,'USER_REQUIRED');
  assert.equal(classifyConsent('Marketing future vacancies',false).consent_type,'OPTIONAL_SKIP');
  assert.equal(classifyConsent('Relocation commitment',true).consent_type,'USER_REQUIRED');
});

test('real Playwright: complex application, human CAPTCHA, recovery, validation, upload, dry-run gate and one backend submit', { timeout: 120000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'jobhunter-browser-'));
  const artifacts = path.join(directory,'artifacts'); await fs.mkdir(artifacts);
  const cv = path.join(artifacts,'fixture-cv.pdf'), bytes = Buffer.from('%PDF-1.4\nFixture test CV\n%%EOF'); await fs.writeFile(cv,bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const board = createMockBoard({ testMode:true,testToken:'fixture-human-token' }); await board.listen();
  t.after(async()=>board.close());
  const config = {...browserConfig({ BROWSER_SERVICE_TOKEN:'fixture-browser-token',ALLOW_MOCK_NETWORK:'true',ALLOW_MOCK_SUBMIT:'true',ARTIFACT_DIR:artifacts,BROWSER_STATE_DIR:path.join(directory,'state') }),port:0};
  const service = await createBrowserService(config); await service.listen(); t.after(async()=>service.close());
  const base='http://127.0.0.1:'+service.server.address().port;
  async function call(endpoint,body,method=body?'POST':'GET'){ const response=await fetch(base+endpoint,{method,headers:{authorization:'Bearer fixture-browser-token','content-type':'application/json'},body:body?JSON.stringify(body):undefined});const result=await response.json();assert.equal(response.status<400,true,JSON.stringify(result));return result }
  assert.equal((await fetch(base+'/sessions')).status,401);
  const listing=await fetch('http://127.0.0.1:3002/api/jobs').then(r=>r.json()); assert.equal(vacancies.length,10);assert.equal(listing.jobs.length,11);assert.equal(listing.jobs.at(-1).canonical_url,listing.jobs.at(-2).canonical_url);
  assert.equal((await fetch('http://127.0.0.1:3002/__test/captcha?draft=x')).status,403);
  let session=await call('/sessions',{application_id:'browser-fixture-application',url:'http://127.0.0.1:3002/apply/mechanical-engineer-42'}), id=session.session_id;
  const fill=async(name,value)=>call('/sessions/'+id+'/fill',{selector:'#'+name,value});
  const select=async(name,value)=>call('/sessions/'+id+'/select',{selector:'#'+name,value});
  const next=async()=>call('/sessions/'+id+'/click',{selector:'#next'});
  const snapshot=async()=>call('/sessions/'+id+'/snapshot');
  for(const [name,value] of Object.entries({first_name:'Test',last_name:'Candidate',email:'fixture@example.invalid',phone:'+48123456789',city:'Wroclaw'}))await fill(name,value);await select('country','Poland');assert.equal((await next()).current_step,2);
  for(const [name,value] of Object.entries({current_title:'Independent R&D designer',years_experience:'0',education:'Mechanical engineering degree'}))await fill(name,value);await select('employment_type','Full-time');await call('/sessions/'+id+'/check',{selector:'#eu_yes'});await call('/sessions/'+id+'/check',{selector:'#cad_experience'});await select('skills',['Fusion 360','Prototyping']);await fill('portfolio_url','https://example.invalid/portfolio');assert.equal((await next()).current_step,3);
  const outside=await fetch(base+'/sessions/'+id+'/upload',{method:'POST',headers:{authorization:'Bearer fixture-browser-token','content-type':'application/json'},body:JSON.stringify({selector:'#cv',path:path.join(directory,'secret.pdf'),sha256})});assert.equal(outside.status,400);
  await call('/sessions/'+id+'/upload',{selector:'#cv',path:cv,sha256});assert.equal((await next()).current_step,4);
  await select('authorized_poland','Yes');await fill('salary_expectation','10000-12000');await fill('fusion_projects','Verified fixture Fusion 360 prototype project');
  let view=await snapshot(); assert.equal(view.fields.find(f=>f.name==='start_date').required,true); assert.equal(view.fields.find(f=>f.name==='start_date').value,'');
  // This deliberately missing answer is supplied by a simulated human, not guessed by production.
  await call('/sessions/'+id+'/checkpoint',{pending_question:{field:'start_date',status:'NEEDS_USER'}});await fill('start_date','2026-11-01');view=await next();assert.equal(view.current_step,5);assert.equal(view.captcha,true);
  const crop=await call('/sessions/'+id+'/captcha-image',{});assert.equal(crop.scope,'CAPTCHA_ELEMENT_CROP');assert.equal(crop.redacted,true);assert.equal(crop.persisted,false);assert.ok(crop.png_base64.startsWith('iVBOR'));
  const captcha=await fixtureHumanCaptcha({baseUrl:'http://127.0.0.1:3002',draftId:view.draft_id,testToken:'fixture-human-token'});await fill('captcha_answer',captcha.code);assert.equal((await next()).current_step,6);
  view=await snapshot();assert.equal(view.fields.some(f=>f.name==='timezone_overlap'),true);await select('work_arrangement','Remote');await fill('timezone_overlap','09:00-17:00 Europe/Warsaw');view=await next();assert.equal(view.current_step,7);
  assert.equal(view.fields.find(f=>f.name==='website_trap').visible,false);
  const trap=await fetch(base+'/sessions/'+id+'/fill',{method:'POST',headers:{authorization:'Bearer fixture-browser-token','content-type':'application/json'},body:JSON.stringify({selector:'#website_trap',value:'spam'})});assert.equal(trap.status,400);
  await fill('salary_format','invalid');await call('/sessions/'+id+'/check',{selector:'#privacy'});view=await next();assert.equal(view.current_step,7);assert.ok(view.fields.find(f=>f.name==='salary_format').validation_message);
  await fill('salary_format','10000-12000 PLN');
  const oldId=id;await call('/sessions/'+id,undefined,'DELETE');const recovered=await call('/sessions/'+oldId+'/recover',{});id=recovered.session_id;assert.equal(recovered.snapshot.current_step,7);assert.equal(recovered.replay_required,true);
  // Server draft preserved previous accepted step; reversible current input is reapplied after DOM inspection.
  await fill('salary_format','10000-12000 PLN');await call('/sessions/'+id+'/check',{selector:'#privacy'});view=await next();assert.equal(view.current_step,8);assert.match(view.text,/fixture-cv.pdf/);
  const direct=await fetch(base+'/sessions/'+id+'/click',{method:'POST',headers:{authorization:'Bearer fixture-browser-token','content-type':'application/json'},body:JSON.stringify({selector:'#final_submit'})});assert.equal(direct.status,400);
  config.allowMockSubmit=false;view=await call('/sessions/'+id+'/submit',{selector:'#final_submit'});assert.equal(view.status,'READY_TO_SUBMIT');assert.equal(view.submit_blocked_reason,'MOCK_SUBMIT_DISABLED');assert.equal(board.submissions.size,0);
  config.allowMockSubmit=true;view=await call('/sessions/'+id+'/submit',{selector:'#final_submit'});assert.equal(view.status,'SUBMITTED');assert.ok(view.confirmation_id);assert.equal(board.submissions.size,1);
  view=await call('/sessions/'+id+'/submit',{selector:'#final_submit'});assert.equal(view.status,'SUBMITTED');
  assert.equal(board.submissions.size,1);
  await call('/sessions/'+id,undefined,'DELETE');const submitRecovery=await call('/sessions/'+id+'/recover',{});assert.equal(submitRecovery.status,'SUBMITTED');assert.equal(board.submissions.size,1);
  const submitted=[...board.submissions.values()][0];assert.equal(submitted.payload.website_trap,'');assert.equal(submitted.payload.marketing,false);assert.equal(submitted.uploaded.cv.name,'fixture-cv.pdf');
});
