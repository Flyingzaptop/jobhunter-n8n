import test from 'node:test';import assert from 'node:assert/strict';import Ajv from 'ajv';
import {cvTailoringPlan,cvTailoringQa,cvWriterSchema,deterministicCvQa,renderCvV2Html,cvSkillRelevance,vacancyKeywordPlan} from '../services/core/cv-v2.mjs';
const profile={education:[{id:'edu',provenance:'EDUCATION',institution:'Technical University',field:'Mechanical Engineering',specialization:'Robotics and Process Automation',status:'degree_in_progress'}],
 experience:[{id:'it',provenance:'PROFESSIONAL',role:'IT Specialist',statements:['Troubleshot Windows workstations.','Worked with Active Directory.'],skills:['Windows','Active Directory']}],
 projects:[{id:'embedded',provenance:'ACADEMIC',title:'Embedded control and automation projects',statements:['Worked with PLC, Arduino, ESP32 and PID concepts.'],skills:['PLC','Arduino','ESP32','PID','automation']},
 {id:'cad',provenance:'ACADEMIC',title:'Cycloidal gearbox',statements:['Designed a cycloidal gearbox in CAD.'],skills:['CAD','mechanical_design']},
 {id:'simulation',provenance:'ACADEMIC',title:'Engineering simulation work',statements:['Performed FEA and CFD simulation.'],skills:['FEA','CFD']},
 {id:'data',provenance:'INDEPENDENT_R_AND_D',title:'Financial ML research',statements:['Built Python data-processing pipelines.','Worked on feature engineering and statistical evaluation.'],skills:['Python','machine_learning']},
 {id:'cpp',provenance:'INDEPENDENT_R_AND_D',title:'Performance profiling',statements:['Worked with C++ concepts.'],skills:['C++']}],
 skills:{software:['basic-to-intermediate C++ only where supported by project evidence','Linux familiarity']},languages:[]};
const engineering={title:'Working Student in Verification & Validation & Test Automation',description_text:'Embedded control and automotive testing; Python.'};
const claim=(text,id)=>({text,source_fact_ids:[id]});
const doc={headline:claim('Mechanical Engineering student | Embedded automation','edu'),summary:[claim('Academic embedded control projects with PLC and Arduino.','embedded')],
 skills:[claim('PLC','embedded'),claim('Arduino','embedded'),claim('ESP32','embedded')],sections:[{source_fact_id:'embedded',bullets:[claim('Worked with PLC, Arduino, ESP32 and PID concepts.','embedded')]}],application_text:[]};
test('engineering target selects engineering evidence before IT even when fit focus overemphasizes hospital work',()=>{
 const plan=cvTailoringPlan(profile,{cv_focus_fact_ids:['it','data']},engineering);
 assert.equal(plan.family,'ENGINEERING_AUTOMATION');assert.equal(plan.preferred_section_ids[0],'embedded');
 assert.ok(plan.allowed_section_ids.includes('it'));assert.ok(plan.secondary_fact_ids.includes('it'));assert.ok(cvTailoringQa(doc,profile,{},engineering).errors.includes('CONFIRMED_PROJECT_BREADTH_MISSING'));
 assert.equal(cvTailoringQa({...doc,sections:[...doc.sections,{source_fact_id:'cad',bullets:[claim('Academic cycloidal gearbox design in CAD.','cad')]}]},profile,{},engineering).pass,true);
 assert.ok(!plan.primary_fact_ids.includes('data'),'feature engineering must not match finite-element FEA');
 const support=cvTailoringPlan(profile,{}, {title:'IT Support Specialist'});
 assert.equal(support.preferred_section_ids[0],'it');assert.notDeepEqual(plan.preferred_section_ids,support.preferred_section_ids);
 assert.equal(cvSkillRelevance('D3D12','IT_SUPPORT'),0);assert.equal(cvSkillRelevance('C++ (basic-to-intermediate)','IT_SUPPORT'),0);
 assert.equal(cvSkillRelevance('Windows','IT_SUPPORT'),100);assert.equal(cvSkillRelevance('PLC','ENGINEERING_AUTOMATION'),100);
});
test('target tailoring refuses generic IT headline/summary and unrelated top sections for engineering',()=>{
 const generic={...doc,headline:claim('IT Specialist | Windows support','it'),summary:[claim('Supported Windows workstations.','it')],
  sections:[{source_fact_id:'it',bullets:[claim('Supported Windows workstations.','it')]}]};
 const qa=cvTailoringQa(generic,profile,{},engineering);assert.equal(qa.pass,false);
 assert.ok(qa.errors.includes('HEADLINE_PRIMARY_EVIDENCE_REQUIRED'));assert.ok(qa.errors.includes('TARGET_SECTION_ORDER_OR_SELECTION'));
 assert.ok(cvTailoringQa({...doc,summary:[claim('Worked with PLC and Arduino.','embedded')]},profile,{},engineering).errors.includes('SUMMARY_PROVENANCE_LABEL_REQUIRED'));
 assert.ok(cvTailoringQa({...doc,skills:[claim('Windows','it'),claim('Active Directory','it')]},profile,{},engineering).errors.includes('TOP_SKILLS_UNRELATED_DOMINANCE'));
 assert.ok(cvTailoringQa({...doc,summary:[claim('Academic embedded projects.','embedded'),claim('Independent research in financial machine learning with extensive data processing and statistical experimentation pipelines.','data')]},profile,{},engineering).errors.includes('SUMMARY_UNRELATED_DOMINANCE'));
});
test('role schema permits secondary employment, rejects uncited sections and preserves skill caps',()=>{
 const plan=cvTailoringPlan(profile,{},engineering),schema=cvWriterSchema(profile,{allowedSectionIds:plan.allowed_section_ids}),validate=new Ajv().compile(schema);
 assert.equal(validate(doc),true);
 assert.equal(validate({...doc,sections:[{source_fact_id:'it',bullets:[claim('Supported Windows workstations.','it')]}]}),true);
 assert.equal(validate({...doc,sections:[{source_fact_id:'invented',bullets:[claim('Unsupported work.','invented')]}]}),false);
 const capped={...doc,skills:[claim('C++ (basic-to-intermediate)','cpp'),claim('Linux familiarity','skill_software_1')]};
 assert.equal(validate(capped),true);assert.equal(deterministicCvQa(capped,profile).pass,true);
 assert.equal(validate({...doc,skills:[claim('C++','cpp')]}),false);
 assert.equal(deterministicCvQa({...doc,skills:[claim('C++','cpp')]},profile).pass,false);
});
test('engineering layout places actual studies before projects and keeps project provenance distinct',()=>{
 const html=renderCvV2Html(doc,profile,'English',{},cvTailoringPlan(profile,{},engineering));
 assert.ok(html.indexOf('<h2>Education</h2>')<html.indexOf('<h2>Projects and research</h2>'));
 assert.match(html,/Degree in progress/);assert.match(html,/Academic project/);assert.ok(!html.includes('IT Specialist'));
});
test('two vacancies in the SAME mechanical family produce different exact requirement evidence and section order',()=>{
 const cadJob={job_id:'cad-vacancy',title:'Junior Mechanical Engineer',description_text:'Requirements:\nCAD and mechanical design.'};
 const plcJob={job_id:'plc-vacancy',title:'Junior Mechanical Engineer',description_text:'Requirements:\nPLC, Arduino, ESP32 and PID.'};
 const cadAnalysis={requirements:[{source_quote:'CAD and mechanical design.',importance:'MANDATORY'}]},plcAnalysis={requirements:[{source_quote:'PLC, Arduino, ESP32 and PID.',importance:'MANDATORY'}]};
 const cadPlan=cvTailoringPlan(profile,cadAnalysis,cadJob),plcPlan=cvTailoringPlan(profile,plcAnalysis,plcJob);
 assert.equal(cadPlan.family,plcPlan.family);assert.equal(cadPlan.preferred_section_ids[0],'cad');assert.equal(plcPlan.preferred_section_ids[0],'embedded');
 assert.notEqual(cadPlan.vacancy_keywords.requirements_hash,plcPlan.vacancy_keywords.requirements_hash);
 assert.deepEqual(cadPlan.vacancy_keywords.entries.filter(e=>e.status==='SUPPORTED').map(e=>e.keyword).sort(),['CAD','mechanical design'].sort());
 const incomplete={...doc,sections:[{source_fact_id:'embedded',bullets:[claim('Worked with PLC, Arduino and ESP32.','embedded')]}]};
 const missing=cvTailoringQa(incomplete,profile,plcAnalysis,plcJob);assert.ok(missing.errors.includes('SUPPORTED_ATS_KEYWORDS_MISSING'),'PID must not silently vanish');
 const complete={...incomplete,headline:{...doc.headline,source_fact_ids:['edu','embedded']},skills:[...doc.skills,claim('PID','embedded')],sections:[...incomplete.sections,{source_fact_id:'cad',bullets:[claim('Academic cycloidal gearbox design in CAD.','cad')]}]};
 assert.equal(cvTailoringQa(complete,profile,plcAnalysis,plcJob).pass,true);
 const coverage=cvTailoringQa(complete,profile,plcAnalysis,plcJob).keyword_coverage;
 assert.ok(coverage.every(entry=>entry.status==='SUPPORTED_COVERED'&&entry.covered_claim_ids.length>0));
});
test('exact ATS evidence lists unsupported technologies and preserves C++/Linux qualification caps',()=>{
 const job={job_id:'embedded',title:'Test Automation Engineer',description_text:'Technology stack:\nC++;\nLinux;\nCAN;\nHardware-in-the-Loop;\nQualifications\nPLC programming required.'};
 const plan=vacancyKeywordPlan(profile,{requirements:[{source_quote:'PLC programming required.',importance:'MANDATORY'}]},job);
 assert.equal(plan.entries.find(e=>e.keyword==='C++').cv_label,'C++ (basic-to-intermediate)');
 assert.equal(plan.entries.find(e=>e.keyword==='Linux').cv_label,'Linux familiarity');
 for(const keyword of ['CAN','Hardware-in-the-Loop'])assert.equal(plan.entries.find(e=>e.keyword===keyword).status,'UNSUPPORTED_DO_NOT_CLAIM');
 const blocked=vacancyKeywordPlan(profile,{requirements:[{source_quote:'PLC programming required.',importance:'MANDATORY',strict:true,match:'NO'}]},job);
 assert.deepEqual(blocked.hard_missing_requirements,['PLC programming required.']);
});
