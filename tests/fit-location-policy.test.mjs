import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import YAML from'yaml';
import{workFormatAnalysis,routeAnalysis,deterministicHardReject,analyzeJob}from'../services/core/fit.mjs';import{computePriority}from'../services/core/priority.mjs';
const policy=YAML.parse(await readFile('config/search_policy.yaml','utf8'));
const profile={candidate:{base_location:{city:'Wroclaw',country:'Poland'},eu_citizen:true},onboarding:{relocation_willing:true},experience:[{id:'verified_professional',provenance:'PROFESSIONAL',duration_approx_years:1.5}]};
const format={remote_allowed:true,hybrid_required:false,remote_region:'Worldwide',work_from_poland_allowed:true,can_hire_in_poland:true,employment_route:'PL_EMPLOYEE'};
const job={job_id:'12345678-1234-1234-1234-123456789012',title:'Mechanical engineer',location:'Worldwide',country:'US',work_mode:'REMOTE',description_text:'Remote work from Poland is permitted.',availability_status:'OPEN',canonical_url:'https://example.invalid/job',content_hash:'fixture-hash'};
const analysis={role_family:'mechanical_engineering',work_format:format,hard_blockers:[],requirements:[{requirement:'CAD required',source_quote:'CAD required',importance:'MANDATORY',category:'TECHNICAL',match:'YES'}]};
test('required Wroclaw base rejects Warsaw/Romania physical presence and mandatory travel without relocation questions',()=>{
 const warsaw={...job,location:'Warsaw, Poland',country:'PL',work_mode:'HYBRID',description_text:'Note: This will be a hybrid onsite internship position.'};
 const result=routeAnalysis({job:warsaw,profile,policy,analysis});assert.equal(result.decision,'REJECT');assert.equal(result.work_format_class,'NONLOCAL_PRESENCE_INELIGIBLE');assert.equal(result.eligible_for_auto_apply,false);
 const romanian=workFormatAnalysis({job:{...job,location:'Cluj-Napoca, Romania',country:'RO',work_mode:'ONSITE'},profile,policy,workFormat:format});assert.equal(romanian.employment_eligibility.blocker,true);
 const travel=workFormatAnalysis({job:{...job,description_text:'Availability for business travel is required.'},profile,policy,workFormat:format});assert.equal(travel.work_format_class,'MANDATORY_TRAVEL_INELIGIBLE');assert.equal(travel.eligible_for_auto_apply,false);
});
test('local hybrid and explicitly remote-from-Poland worldwide/EU stay eligible; employer HQ alone never rejects',()=>{
 const local=workFormatAnalysis({job:{...job,location:'Wrocław, Poland',country:'PL',work_mode:'HYBRID'},profile,policy,workFormat:{...format,office_location:'Wrocław',office_country:'Poland',hybrid_required:true}});
 assert.equal(local.work_format_class,'HYBRID_WROCLAW_LOCAL');assert.equal(local.eligible_for_auto_apply,true);assert.equal(local.location_policy_status,'COMPATIBLE');
 for(const region of['Worldwide','EU']){const remote=workFormatAnalysis({job,profile,policy,workFormat:{...format,remote_region:region,office_location:'San Francisco',office_country:'United States'}});assert.equal(remote.eligible_for_auto_apply,true);assert.equal(remote.employment_eligibility.blocker,false);}
 const ambiguous=workFormatAnalysis({job:{...job,work_mode:'UNKNOWN'},profile,policy,workFormat:{...format,hybrid_required:null}});assert.equal(ambiguous.work_format_class,'UNKNOWN');assert.equal(ambiguous.eligible_for_auto_apply,false);assert.equal(ambiguous.location_policy_status,'UNVERIFIED');
 const nearby=workFormatAnalysis({job:{...job,location:'Bielany Wroclawskie, Poland',country:'PL',work_mode:'HYBRID'},profile,policy,workFormat:{...format,hybrid_required:true}});assert.equal(nearby.eligible_for_auto_apply,false);assert.equal(nearby.employment_eligibility.blocker,false);
});
test('deterministic obvious rejection carries exact policy/fact proof and bypasses model inference',async()=>{
 const warsaw={...job,location:'Warsaw, Poland',country:'PL',work_mode:'HYBRID',description_text:'Note: This will be a hybrid onsite internship position.'};
 const rejected=deterministicHardReject({job:warsaw,profile,policy});assert.equal(rejected.decision,'REJECT');assert.equal(rejected.model,null);assert.equal(rejected.runtime_statistics,null);assert.equal(rejected.inference_performed,false);
 assert.ok(rejected.hard_reject_proof.some(proof=>warsaw.description_text.includes(proof.source_quote)&&proof.policy_source));
 let calls=0;const result=await analyzeJob({job:warsaw,profile,policy,llm:{complete:async()=>{calls++;throw new Error('No inference permitted');}}});assert.equal(result.analysis_method,'DETERMINISTIC_HARD_GATE');assert.equal(calls,0);
 assert.equal(deterministicHardReject({job:{...job,description_text:'Our headquarters are based in the United States. We collaborate remotely worldwide.'},profile,policy}),null);
 assert.ok(deterministicHardReject({job:{...job,location:'Remote from the US'},profile,policy}).reasons.includes('REMOTE_COUNTRY_LOCKED_INELIGIBLE'));
 const locked=deterministicHardReject({job:{...job,description_text:'Applicants must reside in the United States only.'},profile,policy});assert.ok(locked.reasons.includes('REMOTE_COUNTRY_LOCKED_INELIGIBLE'));
 const cityLocked=deterministicHardReject({job:{...job,description_text:'Applicants must reside in Warsaw, Poland.'},profile,policy});assert.ok(cityLocked.reasons.includes('REMOTE_COUNTRY_LOCKED_INELIGIBLE'));
 const years=deterministicHardReject({job:{...job,description_text:'Minimum 3 years of professional experience required.'},profile,policy});assert.ok(years.reasons.includes('VERIFIED_PROFESSIONAL_YEARS_INSUFFICIENT'));assert.equal(years.hard_reject_proof[0].verified_candidate_fact.professional_years,1.5);
 const polish=deterministicHardReject({job:{...job,description_text:'Wymagania\nMinimum 3 lata doświadczenia komercyjnego.'},profile,policy});assert.ok(polish.reasons.includes('VERIFIED_PROFESSIONAL_YEARS_INSUFFICIENT'));
 assert.equal(deterministicHardReject({job:{...job,description_text:'Bachelor degree required.'},profile,policy}),null);
 assert.equal(deterministicHardReject({job:{...job,description_text:'Nice to have:\nAvailability for business travel.'},profile,policy}),null);
});
test('global/EU remote priority is equal and local mechanical hybrid receives only a slight preference',()=>{
 const base={overall_fit:80,role_family:'mechanical_engineering',career_alignment:'HIGH',eligible_for_auto_apply:true,employment_eligibility:{hire_route:'PL_EMPLOYEE'}};
 const worldwide=computePriority({job,policy,analysis:{...base,work_format_class:'REMOTE_WORLDWIDE_FROM_POLAND'}});
 const eu=computePriority({job,policy,analysis:{...base,work_format_class:'REMOTE_EUROPE_FROM_POLAND'}});
 const local=computePriority({job,policy,analysis:{...base,work_format_class:'HYBRID_WROCLAW_LOCAL'}});
 assert.equal(worldwide.application_priority,eu.application_priority);assert.ok(local.application_priority>worldwide.application_priority);assert.ok(local.application_priority-worldwide.application_priority<1);
});
