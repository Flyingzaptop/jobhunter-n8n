import test from 'node:test';import assert from 'node:assert/strict';
import {buildFastFitInput,expandFastFit,analyzeFastFit,FAST_FIT_DEADLINE_MS} from '../services/core/fit-fast.mjs';
const profile={candidate:{base_location:{city:'Wroclaw',country:'Poland'}},education:[{id:'edu',provenance:'EDUCATION',field:'Mechanical Engineering',status:'degree_in_progress'}],projects:[{id:'cad',provenance:'ACADEMIC',title:'Gearbox CAD',skills:['CAD'],statements:['Academic CAD design.']}],languages:[{id:'en',language:'English',level:'B2'}]};
const job={title:'Mechanical Engineer Intern',location:'Wroclaw, Poland',country:'PL',work_mode:'HYBRID',availability_status:'OPEN',description_text:'Requirements:\nCAD knowledge.\nEnglish B2.\nA completed degree is required.\nPreferred qualifications:\nSEP licence.'};
test('single-score input includes location restrictions and unknown geography cannot pass FIT into CV',()=>{
 const source={...job,location:'Remote',country:null,work_mode:'REMOTE',description_text:'Requirements:\nCAD knowledge.\nThis is a remote role. Hiring countries are not specified.'};
 const policy={work_location_policy:{no_relocation:true,forbid_mandatory_travel:true,required_base:{city:'Wroclaw',country:'Poland',remain_physical:true}}};
 const input=buildFastFitInput(source,profile,policy),prompt=JSON.parse(input.prompt);
 assert.equal(prompt.location.work_mode,'REMOTE');assert.equal(prompt.candidate_constraints.no_relocation,true);assert.equal(prompt.candidate_constraints.physical_base.city,'Wroclaw');
 const result=expandFastFit(95,input,{job:source,profile,policy});assert.equal(result.overall_fit,95);assert.equal(result.fit_complete,false);assert.equal(result.cv_eligible,false);assert.equal(result.fit_status,'NEEDS_LOCATION_EVIDENCE');assert.equal(result.decision,'REVIEW');
 const locked={...source,metadata:{validated_applicant_locations:['United States']}};
 assert.equal(expandFastFit(95,buildFastFitInput(locked,profile,policy),{job:locked,profile,policy}).decision,'REJECT');
});
test('one overall score retains source requirements and truthful academic provenance without subscores',()=>{const input=buildFastFitInput(job,profile),a=expandFastFit(65,input,{job,profile});assert.equal(a.overall_fit,65);for(const key of ['technical_fit','experience_fit','education_fit','language_fit','category_scores'])assert.equal(a[key],undefined);assert.ok(a.requirements.some(r=>r.source_quote==='CAD knowledge.'));assert.ok(a.requirements.some(r=>r.source_quote==='SEP licence.'&&r.match==='UNKNOWN'));assert.ok(a.requirements.find(r=>/completed degree/.test(r.requirement)).match!=='YES');assert.ok(a.requirements.find(r=>/CAD/.test(r.requirement)).candidate_evidence_provenance.includes('ACADEMIC'));assert.throws(()=>expandFastFit(101,input,{job,profile}),/INVALID_SCORE/);});
test('local fast model request has no wall-clock deadline and generates only a single score',async()=>{let request;const llm={withModels(options){assert.equal(options.timeoutMs,FAST_FIT_DEADLINE_MS);return {json:async r=>{request=r;return {s:55};},lastStats:{}};}};const a=await analyzeFastFit({job,profile,llm});assert.equal(a.overall_fit,55);assert.deepEqual(request.schema.required,['s']);assert.equal(request.numPredict,64);assert.ok(!Object.hasOwn(request.schema.properties,'requirements'));});

test('fast expansion tolerates professional-year bookkeeping, long requirements and standalone required labels',()=>{
 const longJob={...job,description_text:'Required:\n'+Array.from({length:120},(_,i)=>`CAD tool ${i} knowledge.`).join('\n')+'\nThree years of professional experience.\nOther Required:\nEnglish B2.'};
 const input=buildFastFitInput(longJob,profile),result=expandFastFit(60,input,{job:longJob,profile});
 assert.equal(result.overall_fit,60);assert.ok(result.requirements.length>100);assert.ok(!result.requirements.some(r=>r.source_quote==='Required:'||r.source_quote==='Other Required:'));
 const yearsJob={...job,description_text:'Required:\n2 years of professional CAD experience.'};
 assert.doesNotThrow(()=>expandFastFit(50,buildFastFitInput(yearsJob,profile),{job:yearsJob,profile}));
});

test('hybrid and language extraction use the same evidence rules as final validation',()=>{
 const source={...job,work_mode:'UNKNOWN',description_text:'This will be a hybrid role.\nRequired:\nEnglisch B2.\nCAD knowledge.'};
 const a=expandFastFit(60,buildFastFitInput(source,profile),{job:source,profile});assert.equal(a.work_format.hybrid_required,true);assert.equal(a.requirements.find(r=>r.source_quote==='Englisch B2.').category,'LANGUAGE');
});
