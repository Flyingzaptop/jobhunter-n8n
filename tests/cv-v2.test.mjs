import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {cvIdentityQa,deterministicCvQa,cvClaimCatalog,buildTailoredCv,renderCvV2Html,verifyCvEntailment,resolveCvLlm,cvWriterSchema} from '../services/core/cv-v2.mjs';
import {OllamaClient} from '../services/core/llm.mjs';
import Ajv from 'ajv';

// MOCK / REGRESSION only. No gateway response here is real-world acceptance.
const profile={onboarding:{legal_name:'UNKNOWN',email:'UNKNOWN',phone:'UNKNOWN'},education:[{id:'education',institution:'A university',field:'Mechanical Engineering',status:'degree_in_progress',provenance:'EDUCATION'}],experience:[{id:'it',role:'IT Specialist',provenance:'PROFESSIONAL',duration_approx_years:1.5,statements:['Supported Windows workstations.'],skills:['Windows']}],projects:[{id:'cad',title:'Cycloidal gearbox',provenance:'ACADEMIC',statements:['Designed a cycloidal gearbox in CAD.'],skills:['CAD']},{id:'web',title:'Web applications',provenance:'PERSONAL_PROJECT',statements:['Built web applications using React and Python/Django.'],skills:['React','Python','Django']}],languages:[{id:'pl',language:'Polish',level:'fluent'}]};
const claim=(text,id)=>({text,source_fact_ids:[id]});
const draft=()=>({headline:claim('Mechanical engineering student','education'),summary:[claim('Designed a cycloidal gearbox in CAD.','cad')],skills:[claim('CAD','cad')],sections:[{source_fact_id:'cad',bullets:[claim('Designed a cycloidal gearbox in CAD.','cad')]}],application_text:[]});
const gateway=(document,verdict='SUPPORTED')=>({model:'regression-only',strongModel:'regression-only',async json(args){const result=args.strong ? document : {checks:cvClaimCatalog(document).map(c=>({claim_id:c.claim_id,verdict,reason:'Regression verdict'}))};if(args.validate) await args.validate(result);return result;}});

test('CV v2 keeps factual draft with unknown real identity, never fabricates a PDF',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'cv-v2-regression-'));
  const manifest=await buildTailoredCv({job:{job_id:'mechanical',company:'Regression',title:'Senior Mechanical Engineer',availability_status:'OPEN'},profile,analysis:{cv_focus_fact_ids:['cad','education']},llm:gateway(draft()),outputRoot:root});
  assert.equal(manifest.status,'BLOCKED_IDENTITY');assert.equal(manifest.qa.claims.pass,true);assert.equal(manifest.qa.identity.pass,false);assert.equal(manifest.qa.pass,false);assert.equal(manifest.pdf_path,null);
  const doc=JSON.parse(await readFile(manifest.document_path,'utf8'));assert.equal(doc.headline.text,'Mechanical engineering student');assert.deepEqual(doc.headline.source_fact_ids,['education']);assert.equal(doc.identity.name,null);
  const html=await readFile(manifest.html_path,'utf8');assert.match(html,/Academic project/);assert.match(html,/Degree in progress/);assert.doesNotMatch(html,/Senior Mechanical Engineer|UNKNOWN|Jan Testowy/);
  assert.equal(JSON.parse(await readFile(manifest.source_map_path,'utf8')).claims.length,4);
});

test('independent entailment uncertainty blocks claims even when deterministic checks pass',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'cv-v2-uncertain-'));
  const manifest=await buildTailoredCv({job:{job_id:'uncertain',availability_status:'OPEN'},profile,analysis:{},llm:gateway(draft(),'UNCERTAIN'),outputRoot:root});
  assert.equal(manifest.status,'BLOCKED_CLAIMS');assert.equal(manifest.qa.claims.pass,false);assert.equal(manifest.pdf_path,null);
});

test('deterministic guards reject unsupported skills, numbers, degrees, employers and seniority',()=>{
  for (const [text,id,reason] of [['Used Kubernetes.','web','UNSUPPORTED_SKILL'],['Delivered 42 projects.','web','UNSUPPORTED_NUMBER'],['Senior CAD expert.','cad','SENIORITY_INFLATION'],['Completed degree in Mechanical Engineering.','education','DEGREE_STATUS_INFLATION'],['Employed at Invented Corp.','it','UNSUPPORTED_EMPLOYER'],['3 years of professional React employment.','web','PROVENANCE_INFLATION'],['1.5 years of Windows work.','it','APPROXIMATE_YEARS_AS_EXACT']]){
    const doc=draft();doc.summary=[claim(text,id)];assert(deterministicCvQa(doc,profile).errors.some(e=>e.reason.startsWith(reason)),`${text}: ${reason}`);
  }
  const doc=draft();doc.summary=[claim('Approximately 1.5 years supporting Windows workstations.','it')];assert.equal(deterministicCvQa(doc,profile).pass,true);
});

test('personal React facts cannot be laundered into a professional hospital section',()=>{
  const doc=draft();doc.sections=[{source_fact_id:'it',bullets:[{text:'Built React web applications.',source_fact_ids:['it','web']}]}];
  assert(deterministicCvQa(doc,profile).errors.some(e=>e.reason==='SECTION_PROVENANCE_MISMATCH'));
});

test('skills labels require their own exact verified evidence and language labels preserve provenance',()=>{
  const doc=draft();doc.skills=[claim('Docker','web')];assert.equal(deterministicCvQa(doc,profile).pass,false);
  const html=renderCvV2Html(draft(),profile,'Polish',{name:null,email:null,phone:null});assert.match(html,/Projekt akademicki/);assert.match(html,/Studia w toku/);assert.doesNotMatch(html,/UNKNOWN/);
});

test('identity QA rejects fixture contacts and requires actual name, email and phone',()=>{
  assert.equal(cvIdentityQa({onboarding:{legal_name:'Jan Testowy',email:'fixture@example.invalid',phone:'+48000000000'}}).pass,false);
  assert.equal(cvIdentityQa({onboarding:{legal_name:'Alicja Kowalska',email:'alice@valid-domain.pl',phone:'+48123456789'}}).pass,true);
  assert.deepEqual(cvIdentityQa(profile).missing,['legal_name','email','phone']);
});

test('closed vacancies and unrequested application texts cannot be used',async()=>{
  await assert.rejects(buildTailoredCv({job:{availability_status:'CLOSED'},profile,analysis:{}}),/OPEN/);
  const root=await mkdtemp(path.join(tmpdir(),'cv-v2-unrequested-'));
  const doc=draft();doc.application_text=[{kind:'cover_letter',claims:[claim('Designed a cycloidal gearbox in CAD.','cad')]}];
  const manifest=await buildTailoredCv({job:{job_id:'unrequested',availability_status:'OPEN'},profile,analysis:{},llm:gateway(doc),outputRoot:root});
  assert.equal(manifest.status,'BLOCKED_CLAIMS');assert.match(manifest.qa.error.message,/Unrequested/);
});

test('verifier cannot omit or duplicate claim IDs',async()=>{
  const llm={async json(args){const result={checks:cvClaimCatalog(draft()).map(()=>({claim_id:'claim_0',verdict:'SUPPORTED',reason:'mock'}))};await args.validate(result);return result;}};
  await assert.rejects(verifyCvEntailment(draft(),profile,llm),/omitted or duplicated/);
});

test('YAML one-entry skill map preserves the original limited-experience qualifier',()=>{
  const source={...profile,skills:{other:[{Blender:'limited experience'}]}};
  const document=draft();document.skills=[claim('Blender: limited experience','skill_other_0')];
  assert.equal(deterministicCvQa(document,source).pass,true);
  document.skills=[claim('Blender','skill_other_0')];assert.equal(deterministicCvQa(document,source).pass,false);
});

test('rejected real job context can exercise factual writing only as conspicuous diagnostic content',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'cv-v2-rejected-'));
  const manifest=await buildTailoredCv({job:{job_id:'rejected',availability_status:'OPEN'},profile,analysis:{decision:'REJECT'},llm:gateway(draft()),outputRoot:root});
  assert.equal(manifest.status,'REJECTED_DIAGNOSTIC_CONTENT');assert.equal(manifest.content_status,'BLOCKED_IDENTITY');assert.equal(manifest.application_eligible,false);assert.equal(manifest.source_decision,'REJECT');assert.equal(manifest.qa.pass,false);assert.equal(manifest.pdf_path,null);
});

test('digits inside grounded technology names are not invented numeric claims',()=>{
  const p={...profile,projects:[...profile.projects,{id:'embedded',title:'Controls',provenance:'ACADEMIC',statements:['Worked with ESP32 and FLOW-3D.'],skills:['ESP32','FLOW-3D']}]};
  const document=draft();document.skills=[claim('ESP32','embedded'),claim('FLOW-3D','embedded')];document.summary=[claim('Worked with ESP32 and FLOW-3D.','embedded')];assert.equal(deterministicCvQa(document,p).pass,true);
  document.summary=[claim('Built 32 embedded systems.','embedded')];assert(deterministicCvQa(document,p).errors.some(e=>e.reason==='UNSUPPORTED_NUMBER:32'));
});

test('degree in progress does not establish an unspecified BSc or MSc qualification level',()=>{
  const document=draft();document.headline=claim('Mechanical Engineering BSc student','education');
  assert(deterministicCvQa(document,profile).errors.some(e=>e.reason==='UNSUPPORTED_DEGREE_LEVEL'));
});

test('academic/personal projects cannot silently become independent R&D in a summary',()=>{
  const document=draft();document.summary=[claim('Independent R&D designing cycloidal gearboxes.','cad')];assert(deterministicCvQa(document,profile).errors.some(e=>e.reason==='RESEARCH_PROJECT_SCOPE_MISMATCH'));
});

test('scoped CV models preserve the global fit client and explicit injected gateways',()=>{
  const client=new OllamaClient({baseUrl:'http://127.0.0.1:11434',model:'qwen3.5:4b',strongModel:'qwen3.5:4b'});
  const selected=resolveCvLlm(client,{CV_WRITER_MODEL:'gemma4:e2b-it-qat',CV_VERIFIER_MODEL:'gemma4:e2b-it-qat'});
  assert.equal(selected.model,'gemma4:e2b-it-qat');assert.equal(selected.strongModel,'gemma4:e2b-it-qat');assert.equal(selected.baseUrl,client.baseUrl);
  assert.equal(client.model,'qwen3.5:4b');assert.equal(client.strongModel,'qwen3.5:4b');assert.equal(resolveCvLlm(client,{}),client);
  const injected=gateway(draft());assert.equal(resolveCvLlm(injected,{CV_WRITER_MODEL:'gemma4:e2b-it-qat'}),injected);
});

test('writer omits undocumented RL policy clauses while authoritative fact map retains original evidence',async()=>{
  const original='Ran supervised, unsupervised and self-supervised learning experiments; reinforcement-learning work may be referenced only where documented in project evidence.';
  const source={...profile,projects:[...profile.projects,{id:'research',provenance:'INDEPENDENT_R_AND_D',title:'Research',statements:[original],skills:['Python']}]};
  const root=await mkdtemp(path.join(tmpdir(),'cv-v2-policy-'));const llm=gateway(draft());const invoke=llm.json;
  llm.json=async args=>{if(args.strong){const facts=JSON.parse(args.prompt).facts;assert.equal(facts.find(f=>f.id==='research').statements[0],'Ran supervised, unsupervised and self-supervised learning experiments');}return invoke(args);};
  const manifest=await buildTailoredCv({job:{job_id:'policy',availability_status:'OPEN'},profile:source,analysis:{},llm,outputRoot:root});
  const map=JSON.parse(await readFile(manifest.source_map_path,'utf8'));assert.equal(map.facts.find(f=>f.id==='research').statements[0],original);assert.equal(source.projects.at(-1).statements[0],original);
});

test('writer skill grammar requires exact labels and citations that establish that particular skill',()=>{
  const check=new Ajv({strict:true}).compile(cvWriterSchema(profile));
  const document=draft();assert.equal(check(document),true);
  document.skills=[claim('Python','it')];assert.equal(check(document),false);
  document.skills=[claim('Python','web')];assert.equal(check(document),true);
  document.skills=[claim('Python expert','web')];assert.equal(check(document),false);
  document.skills=[{text:'Python',source_fact_ids:['web','it']}];assert.equal(check(document),false);
});
