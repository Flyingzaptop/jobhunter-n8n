import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import YAML from 'yaml';
import {workFormatAnalysis,sourceFragmentCatalog,compactSchemaForJob,enforceSkillQualifiers,validateFactIntegrity,normalizeWorkFormatUnknowns,groundedWorkNumbers} from '../services/core/fit.mjs';
const profile=YAML.parse(await readFile(new URL('./fixtures/candidate_profile_test.yaml',import.meta.url),'utf8'));
const baseFormat={remote_allowed:true,remote_region:'EU',employee_residency_requirement:null,office_location:null,office_country:null,
 office_distance_km:null,hybrid_required:false,onsite_days_per_week:null,onsite_days_per_month:null,onsite_frequency_text:null,
 business_travel_required:null,relocation_required:null,work_from_poland_allowed:true,can_hire_in_poland:null,employment_route:'UNKNOWN',
 work_authorization_required:null,authorization_known_impossible:false,sponsorship_available:null,security_clearance_requirement:null,
 export_control_requirement:null,evidence:[]};
test('UNKNOWN string sentinels never establish a known foreign residency/country/clearance blocker',()=>{
 const format={...baseFormat,employee_residency_requirement:'UNKNOWN',office_country:'UNKNOWN',office_location:'UNKNOWN',security_clearance_requirement:'UNKNOWN',export_control_requirement:'None',work_authorization_required:'N/A'};
 const result=workFormatAnalysis({job:{location:'Warsaw, Poland'},profile,workFormat:format});
 assert.equal(result.employment_eligibility.blocker,false);assert.ok(!result.reasons.includes('REMOTE_COUNTRY_LOCKED_INELIGIBLE'));
 assert.ok(!result.reasons.includes('SPECIAL_AUTHORIZATION_REVIEW'));assert.equal(result.eligible_for_auto_apply,false);
 assert.equal(normalizeWorkFormatUnknowns(format).employment_route,'UNKNOWN');
 const foreign=workFormatAnalysis({job:{location:'Remote'},profile,workFormat:{...baseFormat,employee_residency_requirement:'United States only',work_from_poland_allowed:false}});
 assert.equal(foreign.employment_eligibility.blocker,true);assert.equal(foreign.work_format_class,'REMOTE_COUNTRY_LOCKED_INELIGIBLE');
});
test('explicit quoted hybrid arrangement prevents false full-remote classification and nonlocal Poland stays REVIEW',()=>{
 const job={title:'Engineering Internship',location:'Warsaw, Poland',country:null,description_text:'Note: This will be a hybrid onsite internship position.'};
 const result=workFormatAnalysis({job,profile,workFormat:{...baseFormat,office_country:'UNKNOWN',employee_residency_requirement:'UNKNOWN'}});
 assert.equal(result.work_format_class,'HYBRID_POLAND_NONLOCAL_REVIEW');assert.equal(result.eligible_for_auto_apply,false);assert.equal(result.employment_eligibility.blocker,false);
 const schema=compactSchemaForJob(job,profile);assert.deepEqual(schema.properties.work_format.properties.hybrid_required,{const:true});
 const invalid={role_family:'mechanical_engineering',role_level:'junior',hard_blockers:[],requirements:[],matched_fact_ids:[],gaps:[],cv_focus_fact_ids:[],keywords_supported_by_profile:[],keywords_not_supported_by_profile:[],career_alignment:'HIGH',reasoning_summary:'Fixture',work_format:{...baseFormat,evidence:[job.description_text]}};
 assert.throws(()=>validateFactIntegrity(invalid,profile,job),/Explicit hybrid vacancy/);
});
test('hallucinated zero attendance/distance cannot turn a generic hybrid note into rare travel or local Wroclaw',()=>{
 const job={title:'Internship',location:'Warsaw, Poland',description_text:'Note: This will be a hybrid onsite internship position.'};
 const format={...baseFormat,hybrid_required:true,office_location:'Warsaw',office_country:'PL',onsite_days_per_week:0,onsite_days_per_month:0,office_distance_km:0};
 const schema=compactSchemaForJob(job,profile);for(const key of ['onsite_days_per_week','onsite_days_per_month','office_distance_km'])assert.deepEqual(schema.properties.work_format.properties[key],{const:null});
 const result=workFormatAnalysis({job,profile,workFormat:format});assert.equal(result.work_format_class,'HYBRID_POLAND_NONLOCAL_REVIEW');assert.equal(result.eligible_for_auto_apply,false);
});
test('explicit numeric/word office frequencies remain supported while unrelated leave days cannot ground onsite claims',()=>{
 const monthly={title:'Role',location:'Warsaw, Poland',description_text:'Hybrid office attendance: 1 day/month.'};
 const weekly={...monthly,description_text:'Office attendance: two days weekly.'};
 assert.equal(groundedWorkNumbers(monthly,profile).onsite_days_per_month,1);assert.equal(groundedWorkNumbers(weekly,profile).onsite_days_per_week,2);
 const result=workFormatAnalysis({job:monthly,profile,workFormat:{...baseFormat,hybrid_required:true,office_location:'Warsaw',office_country:'PL',can_hire_in_poland:true,employment_route:'PL_EMPLOYEE'}});
 assert.equal(result.work_format_class,'HYBRID_POLAND_RARE_TRAVEL');
 assert.equal(groundedWorkNumbers({...monthly,description_text:'Paid leave: two days monthly.'},profile).onsite_days_per_month,null);
 assert.equal(groundedWorkNumbers({...monthly,description_text:'The office is 25 km from Wroclaw.'},profile).office_distance_km,25);
});
test('German example abbreviation retains exact CAD qualifier and category hints prevent all-education misclassification',()=>{
 const clause='Erfahrungen und Know-how: Kenntnisse in CAD-Systemen (z.B. Solid Edge, SolidWorks) und fertigungsgerechter Konstruktion/Zeichnungserstellung';
 const job={title:'Praktikum',description_text:`Unternehmensbeschreibung\nBei Bosch gestalten wir Zukunft.\nStellenbeschreibung\nDabei erstellst du präzise CAD-Modelle.\nQualifikationen\nAusbildung: Studium im Bereich Maschinenbau oder vergleichbar\n${clause}\nSprachen: verhandlungssicheres Deutsch und gutes Englisch\nArbeitsalltag: deine Präsenz vor Ort ist erforderlich\nZusätzliche Informationen\nBeginn: März 2027`};
 const catalog=sourceFragmentCatalog(job),cad=catalog.find(f=>f.text===clause);assert.ok(cad);assert.equal(cad.list_container,false);assert.equal(cad.category_hint,'TECHNICAL');
 const schema=compactSchemaForJob(job,profile,catalog);assert.deepEqual(schema.properties.explicit_requirements.properties[String(cad.id)].properties.category,{const:'TECHNICAL'});
 for(const fragment of catalog.filter(f=>/Bei Bosch|Dabei erstellst|Beginn:/.test(f.text))){assert.equal(fragment.context_only,true);assert.ok(!Object.hasOwn(schema.properties.requirements.properties,String(fragment.id)));}
 assert.equal(catalog.find(f=>f.text.startsWith('Sprachen:')).category_hint,'LANGUAGE');assert.equal(catalog.find(f=>f.text.startsWith('Arbeitsalltag:')).category_hint,'LOCATION');
});
test('unsupported agile environment becomes UNKNOWN; documented agile fact remains a supported YES',()=>{
 const row={category:'TECHNICAL',requirement:'Experience working in an agile environment.',match:'YES',candidate_evidence_fact_ids:['project_mech'],reason:'Wrongly inferred from project'};
 assert.equal(enforceSkillQualifiers([row],profile)[0].match,'UNKNOWN');
 const documented={...profile,facts:[{id:'agile_actual',provenance:'PROFESSIONAL',statements:['Worked in a documented Scrum agile team.']}]};
 assert.equal(enforceSkillQualifiers([{...row,candidate_evidence_fact_ids:['agile_actual']}],documented)[0].match,'YES');
});
test('skill qualifier guard uses exact source quotation over a potentially softened requirement paraphrase',()=>{
 const row={category:'TECHNICAL',source_quote:'Experience working in an agile environment.',requirement:'General software project experience',match:'YES',candidate_evidence_fact_ids:['project_mech']};
 assert.equal(enforceSkillQualifiers([row],profile)[0].match,'UNKNOWN');
});
test('ordinary qualification and nice-to-have headings scope bodies while employer/responsibility/recruitment sections stay context',()=>{
 const j={title:'IT Intern',description_text:"Who We Are\nOur company builds sensors.\nWhat You'll Do\nManage device deployment.\nWho You Are:\nYou have basic computer knowledge.\nNice to Have\nPython familiarity.\nRecruitment Process\nTechnical interview onsite."};
 const catalog=sourceFragmentCatalog(j);assert.equal(catalog.find(f=>f.text==='Nice to Have').context_only,true);
 assert.equal(catalog.find(f=>f.text==='Python familiarity.').importance_hint,'NICE_TO_HAVE');
 assert.equal(catalog.find(f=>f.text==='You have basic computer knowledge.').importance_hint,'MANDATORY');
 for(const text of ['Our company builds sensors.','Manage device deployment.','Technical interview onsite.'])assert.equal(catalog.find(f=>f.text===text).context_only,true);
});
test('MUST HAVE scopes true qualifications and WHAT WE OFFER/HOW TO APPLY stop preferences from leaking into benefits and instructions',()=>{
 const j={title:'Engineering Intern',description_text:'WHAT YOU WILL DO\nSupport testing including producing required documentation\nWHAT WE ARE LOOKING FOR\nMUST HAVE:\nEnrolled in a Bachelor of Engineering (Mechanical or Aerospace)\nNICE TO HAVE:\nPart of a University Project team (e.g. Rocketry, Rover Team)\nWHAT WE OFFER\nMentorship from engineers and professionals\nHOW TO APPLY\nPlease ensure you submit a cover letter, explaining interest.\nWHAT TO EXPECT\nOur people work as a team.'};
 const catalog=sourceFragmentCatalog(j);const degree=catalog.find(f=>f.text.startsWith('Enrolled'));assert.equal(degree.importance_hint,'MANDATORY');
 const example=catalog.find(f=>f.text.startsWith('Part of a University'));assert.equal(example.list_container,false);assert.equal(example.importance_hint,'NICE_TO_HAVE');
 for(const text of ['MUST HAVE:','WHAT WE OFFER','Mentorship from engineers and professionals','Please ensure you submit a cover letter, explaining interest.']){const f=catalog.find(f=>f.text===text);assert.equal(f.importance_hint,null);assert.equal(f.context_only,true);}
 assert.equal(catalog.find(f=>f.text.startsWith('Support testing')).importance_hint,null);
});
test('conditional US-only office footer stays exact context for explicit New Zealand role while matching US legal condition remains a requirement',()=>{
 const text='FOR CANDIDATES SEEKING TO WORK IN US OFFICES ONLY:\nTo meet U.S. regulations, applicants must possess U.S. citizenship or permanent residency.\nFOR CANDIDATES SEEKING TO WORK IN NEW ZEALAND OFFICES ONLY:\nValid access authorization required.';
 const nz=sourceFragmentCatalog({title:'Intern',location:'Auckland, NZ',description_text:text});
 const us=nz.find(f=>f.text.startsWith('To meet U.S.'));assert.ok(us);assert.equal(us.context_only,true);assert.equal(us.importance_hint,null);assert.equal(us.conditional_region,'united states');
 assert.equal(nz.find(f=>f.text==='Valid access authorization required.').importance_hint,'MANDATORY');
 const matching=sourceFragmentCatalog({title:'Intern',country:'US',description_text:text});assert.equal(matching.find(f=>f.text.startsWith('To meet U.S.')).importance_hint,'MANDATORY');
});
test('strong C++ and prior Linux work cannot be inflated from basic/intermediate concepts or familiarity',()=>{
 const p={facts:[{id:'cpp_basic',provenance:'INDEPENDENT_R_AND_D',skills:['C++'],statements:['Basic-to-intermediate C++ concepts and profiling experiments.']}],skills:{tools:['Linux familiarity','Python']}};
 const rows=[{category:'TECHNICAL',requirement:'C++ proficiency is a strong plus',match:'YES',candidate_evidence_fact_ids:['cpp_basic']},
  {category:'TECHNICAL',requirement:'Previous experience working with Ubuntu or other Linux distributions.',match:'YES',candidate_evidence_fact_ids:['skill_tools_0']},
  {category:'TECHNICAL',requirement:'Proficient in Python',match:'YES',candidate_evidence_fact_ids:['skill_tools_1']}];
 const result=enforceSkillQualifiers(rows,p);assert.equal(result[0].match,'PARTIAL');assert.equal(result[1].match,'PARTIAL');assert.equal(result[2].match,'YES');
 assert.ok(result[0].semantic_qa);assert.ok(result[1].semantic_qa);
});
