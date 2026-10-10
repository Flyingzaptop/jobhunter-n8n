import {randomUUID, createHash} from 'node:crypto';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import {chromium} from 'playwright';
import {PDFParse} from 'pdf-parse';
import {factIndex,sourceFragmentCatalog} from './fit.mjs';
import {OllamaClient, StructuredOutputError} from './llm.mjs';
import {observe,operationContext} from './observability.mjs';
import {composeExtractiveCv,verifyExtractiveCv} from './cv-extractive.mjs';
import {canonicalAnalysisHash} from './evidence-hash.mjs';

export const CV_V2_VERSION = 'cv-factory-v2.5-extractive-fast';
// Previously reviewed, evidence-verified PDFs remain valid until a new PDF replaces them.
export const compatibleCvTemplate=version=>[CV_V2_VERSION,'cv-factory-v2.4-project-breadth','cv-factory-v2.3-exact-vacancy'].includes(version);
const ajv = new Ajv({strict:true, allErrors:true});
const str = {type:'string', minLength:1};
const obj = properties => ({type:'object', additionalProperties:false, properties, required:Object.keys(properties)});
const array = (items, maxItems) => ({type:'array', items, maxItems});
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/gi,'l').replace(/_/g,' ').toLowerCase();
const known = value => typeof value === 'string' && value.trim() && !/^(unknown|null|n\/a)$/i.test(value.trim());
const cleanFact = fact => Object.fromEntries(Object.entries(fact).filter(([,value]) => value !== 'UNKNOWN' && value !== null));
const writerFact = fact => ({...fact,...(fact.statements?{statements:fact.statements.map(s=>typeof s==='string' ? s.replace(/;\s*reinforcement-learning work may be referenced only where documented in project evidence\.?/gi,'') : s)}:{})});
const hash = value => createHash('sha256').update(value).digest('hex');
const safeSlug = value => String(value ?? '').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80) || 'unidentified';
// YAML permits `- Blender: limited experience` as a one-entry object. Preserve
// that supplied qualifier rather than coercing it to "[object Object]".
const skillText = value => {
  if (typeof value==='string') return value;
  if (value && typeof value==='object' && !Array.isArray(value) && Object.entries(value).length===1) {
    const [name,level]=Object.entries(value)[0];
    if (typeof level==='string') return `${name}: ${level}`;
  }
  throw new Error('Invalid verified skill format');
};
const escape = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function resolveCvLlm(llm,environment=process.env) {
  // An explicitly injected gateway is a regression/integration seam. Scoped
  // production configuration must not replace that test seam or global fit LLM.
  if(llm && !(llm instanceof OllamaClient))return llm;
  const original=llm??new OllamaClient();
  if(!environment.CV_WRITER_MODEL && !environment.CV_VERIFIER_MODEL)return original;
  return original.withModels({model:environment.CV_VERIFIER_MODEL||original.model,strongModel:environment.CV_WRITER_MODEL||original.strongModel});
}

export function cvIdentityQa(profile) {
  const identity = profile.onboarding ?? {};
  const name = identity.legal_name ?? profile.candidate?.legal_name ?? profile.identity?.legal_name;
  const email = identity.email ?? profile.identity?.email;
  const phone = identity.phone ?? profile.identity?.phone;
  const fixture = /(?:fixture|testowy|example(?:\.invalid|\.com)|placeholder|john doe|jane doe|test candidate)/i;
  const invalid = value => !known(value) || fixture.test(value);
  const missing = [];
  if (/fixture|example-only|^test[-_]/i.test(profile.profile_id ?? '') || profile.test_fixture === true) missing.push('real_profile');
  if (invalid(name) || !/\S+\s+\S+/.test(name)) missing.push('legal_name');
  if (invalid(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) missing.push('email');
  if (invalid(phone) || phone.replace(/\D/g,'').length < 7 || /^0+$/.test(phone.replace(/\D/g,''))) missing.push('phone');
  return {pass:missing.length === 0, status:missing.length ? 'BLOCKED_IDENTITY' : 'PASS', missing,
    identity:{name:!invalid(name) ? name : null, email:!invalid(email) ? email : null, phone:!invalid(phone) ? phone : null}};
}

const engineeringTerms=/mechanical|engineering|embedded|automation|control|robotic|simulation|cad|prototyp|gearbox|turbine|fea|cfd|plc|arduino|esp32|pid|inzynier|mechanik|automaty|robotyk/;
export function cvSkillRelevance(skill,family){const text=normalize(skill);
 if(family==='IT_SUPPORT')return /active directory|workstation|network|\blan\b|printer|peripheral|windows|linux/.test(text)?100:0;
 if(family==='MECHANICAL')return /\bcad\b|autocad|\bnx\b|technical drawing|3d printing|fusion|mechanical|prototyp|\bfea\b|\bcfd\b|flow.3d|simulation|aerodynamic/.test(text)?100:/robotic|automation|\bplc\b|arduino|esp32|\bpid\b/.test(text)?50:0;
 if(family==='ENGINEERING_AUTOMATION')return /\bplc\b|arduino|esp32|\bpid\b|automation|robotic/.test(text)?100
  :/\bcad\b|mechanical|prototyp|\bfea\b|\bcfd\b|simulation|aerodynamic/.test(text)?70:/python|c\+\+|^c$|linux|git|profiling|benchmark/.test(text)?50:0;
 if(family==='SOFTWARE')return /python|react|django|javascript|typescript|html|css|rest.api|c\+\+|^c$|linux|git/.test(text)?100:0;
 if(family==='DATA')return /python|machine.learning|data.science|time.series|experiment|research|statistic/.test(text)?100:/linux|git/.test(text)?50:0;
 return 1;
}
export function cvTargetFamily(job={},analysis={}){
 const title=normalize(job.title),body=normalize(job.description_text),role=normalize(analysis.role_family);
 if(/mechanical|cad|constructor|konstruktor|mechanik|simulation|cae/.test(title))return 'MECHANICAL';
 if(/utrzymani.*ruchu|elektromechan|mechatron|automatyk/.test(title))return 'ENGINEERING_AUTOMATION';
 if(/support|customer service|helpdesk|service desk|it administr|informatyk|wsparci.*it|wsparci.*techniczn.*system/.test(title))return 'IT_SUPPORT';
 if(/automat/.test(title)&&/playwright|selenium|rest assured|postman|zapier|n8n|low.code|no.code|software quality|api testing/.test(body)&&!/plc|robotic|sensors|actuators|industrial control/.test(body))return 'SOFTWARE';
 if(/embedded|automat|robotic|verification.*validation|hardware.*test|test.*hardware/.test(title))return 'ENGINEERING_AUTOMATION';
 if(/data scien|machine learning|\bml\b|data engineer/.test(title))return 'DATA';
 if(/software|developer|programmer|frontend|backend|full.?stack/.test(title))return 'SOFTWARE';
 if(/mechanical/.test(role))return 'MECHANICAL';
 if(/embedded|automation/.test(role)||/microcontroller|hardware.in.the.loop/.test(body)&&/test|engineering/.test(title))return 'ENGINEERING_AUTOMATION';
 return 'GENERAL';
}
const cappedSkill=(raw,profile)=>{const text=skillText(raw).replace(/_/g,' ');
 const cap=(profile.skills?.software??[]).some(value=>/basic.*c\+\+/i.test(skillText(value)));
 return cap&&/^(?:c\+\+|basic.*c\+\+.*)$/i.test(text)?'C++ (basic-to-intermediate)':text;};
const keywordDefinitions=[
 ['CAD',['CAD']],['Fusion 360',['Fusion 360']],['SolidWorks',['SolidWorks']],['CATIA',['CATIA']],['ANSYS',['ANSYS']],
 ['FEA',['FEA','finite-element','finite element']],['CFD',['CFD','computational fluid dynamics']],['FLOW-3D',['FLOW-3D']],
 ['PLC',['PLC']],['Arduino',['Arduino']],['ESP32',['ESP32']],['PID',['PID']],['Python',['Python']],['C++',['C++']],
 ['Linux',['Linux']],['Git',['Git','GitHub']],['React',['React']],['Django',['Django']],['JavaScript',['JavaScript']],
 ['SQL',['SQL']],['Docker',['Docker']],['Windows',['Windows']],['Active Directory',['Active Directory']],
 ['CAN',['CAN']],['FlexRay',['FlexRay']],['SPI',['SPI']],['I2C',['I2C']],
 ['Hardware-in-the-Loop',['Hardware-in-the-Loop','Hardware in the Loop','HIL']],
 ['Software-in-the-Loop',['Software-in-the-Loop','Software in the Loop','SIL']],
 ['English',['English','angielski','angielskiego']],['Polish',['Polish','polski','polskiego']],
 ['mechanical design',['mechanical design','projektowanie mechaniczne','konstrukcja mechaniczna']],['prototyping',['prototyping','prototype','prototypes','prototypowanie']],
 ['automation',['automation','automatyzacja','automatyzacji','automatyka','automatyki']],['machine learning',['machine learning']],['data science',['data science']]
];
const hasKeyword=(text,term)=>term==='CAN'?/\bCAN\b/.test(String(text)):new RegExp(`(^|[^a-z0-9])${normalize(term).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^a-z0-9]|$)`,'i').test(normalize(text));
export function vacancyKeywordPlan(profile,analysis={},job={}){
 const facts=[...factIndex(profile).values()],catalog=sourceFragmentCatalog(job);
 const requirements=Array.isArray(analysis.requirements)&&analysis.requirements.length?analysis.requirements:catalog.filter(f=>f.importance_hint&&!f.list_container).map(f=>({source_quote:f.text,importance:f.importance_hint}));
 const clauses=requirements.filter(req=>typeof req.source_quote==='string'&&req.source_quote&&String(job.description_text??'').includes(req.source_quote));
 for(const fragment of catalog.filter(f=>f.importance_hint&&!f.list_container))if(!clauses.some(req=>req.source_quote===fragment.text))clauses.push({source_quote:fragment.text,importance:fragment.importance_hint});
 let stack=false;
 for(const line of String(job.description_text??'').split(/\n+/).map(text=>text.trim()).filter(Boolean)){
  if(/^(?:technology stack|tech stack|technologie|stos technologiczny)\s*:?$/i.test(line)){stack=true;continue;}
  if(stack&&/^(?:qualifications|requirements|benefits|additional information|wymagania|co oferujemy|czego oczekujemy)\s*[:?]?$/i.test(line))stack=false;
  if(stack&&!clauses.some(req=>req.source_quote===line))clauses.push({source_quote:line,importance:'DESCRIPTION_ONLY'});
 }
 const definitions=new Map(keywordDefinitions.map(([keyword,aliases])=>[normalize(keyword),{keyword,aliases}]));
 // Candidate-specific exact skill labels are also ATS terms, including names
 // not in the small technology vocabulary above. No target skills are invented.
 for(const fact of facts)for(const raw of fact.skills??[]){const label=cappedSkill(raw,profile);if(label.length<100&&!definitions.has(normalize(label)))definitions.set(normalize(label),{keyword:label,aliases:[label]});}
 for(const req of clauses)if(typeof req.skill==='string'&&req.skill.trim().length<100&&!definitions.has(normalize(req.skill)))definitions.set(normalize(req.skill),{keyword:req.skill.trim(),aliases:[req.skill.trim()]});
 const entries=[];
 for(const {keyword,aliases} of definitions.values()){
  const matches=clauses.filter(req=>aliases.some(term=>hasKeyword(req.source_quote,term)||hasKeyword(req.skill??'',term)));
  if(!matches.length)continue;
  const supporting=facts.filter(fact=>aliases.some(term=>hasKeyword(JSON.stringify(Object.fromEntries(Object.entries(fact).filter(([key])=>!['id','provenance'].includes(key)))),term)));
  const importance=matches.some(req=>req.importance==='MANDATORY')?'MANDATORY':matches.some(req=>req.importance==='STRONG_PREFERENCE')?'STRONG_PREFERENCE':matches.some(req=>req.importance==='NICE_TO_HAVE')?'NICE_TO_HAVE':'DESCRIPTION_ONLY';
  const label=keyword==='C++'?cappedSkill(keyword,profile):keyword==='Linux'&&facts.some(f=>(f.skills??[]).some(s=>/linux familiarity/i.test(skillText(s))))?'Linux familiarity':keyword;
  entries.push({keyword,cv_label:label,aliases,importance,weight:importance==='MANDATORY'?120:importance==='STRONG_PREFERENCE'?60:importance==='NICE_TO_HAVE'?20:10,
   source_quotes:[...new Set(matches.map(req=>req.source_quote))],source_fact_ids:supporting.map(f=>f.id),
   evidence_clauses:supporting.map(f=>({fact_id:f.id,provenance:f.provenance,
    clauses:f.statements??[f.title,f.field,f.specialization,f.language,f.level,...(f.skills??[]).map(skillText)].filter(value=>typeof value==='string'&&value),
    qualification_level:f.level??label,education_status:f.provenance==='EDUCATION'?f.status??null:null})),
   status:supporting.length?'SUPPORTED':'UNSUPPORTED_DO_NOT_CLAIM'});
 }
 return {job_id:job.job_id??null,job_content_hash:job.content_hash??hash(job.description_text??''),
  requirements_hash:canonicalAnalysisHash({job_id:job.job_id??null,content_hash:job.content_hash??hash(job.description_text??''),requirements:clauses}),source_catalog_hash:canonicalAnalysisHash(catalog),entries,
  hard_missing_requirements:clauses.filter(req=>req.importance==='MANDATORY'&&req.strict===true&&req.match==='NO').map(req=>req.source_quote)};
}
export function cvTailoringPlan(profile,analysis={},job={}){
 const family=cvTargetFamily(job,analysis),facts=[...factIndex(profile).values()];
 const vacancyKeywords=vacancyKeywordPlan(profile,analysis,job);
 const exactScore=fact=>vacancyKeywords.entries.filter(entry=>entry.source_fact_ids.includes(fact.id)&&!(family==='SOFTWARE'&&/^automation$/i.test(entry.keyword)&&/plc|robotic|arduino|esp32|sensors|actuators/i.test(JSON.stringify(fact))&&!/python|software|web application/i.test(JSON.stringify(fact)))).reduce((n,entry)=>n+entry.weight,0);
 const strength=fact=>{const text=normalize([fact.title,fact.role,fact.field,fact.specialization,...(fact.skills??[]).map(skillText),...(fact.statements??[])].join(' '));
  if(family==='IT_SUPPORT')return /active directory|workstation|hospital|troubleshoot|it specialist/.test(text)?100:/network|linux|windows/.test(text)?55:0;
  if(family==='MECHANICAL')return /mechanical|\bcad\b|gearbox|turbine|prototyp|\bfea\b|\bcfd\b|flow.3d/.test(text)?100:/embedded|\bplc\b|robotic|automation/.test(text)?35:0;
  if(family==='ENGINEERING_AUTOMATION')return /embedded|\bplc\b|arduino|esp32|\bpid\b|robotic|process automation/.test(text)?100
   :/simulation|\bfea\b|\bcfd\b|gearbox|turbine|mechanical.design|prototyp/.test(text)?70:/c\+\+|profiling|benchmark/.test(text)?50:/python|data.processing|experiment/.test(text)?35:0;
  if(family==='DATA')return /machine.learning|data.science|time.series|feature.engineer|statistical/.test(text)?100:/python/.test(text)?55:0;
  if(family==='SOFTWARE')return /web.application|react|django|rest.api|javascript/.test(text)?100:/python|c\+\+|linux|git/.test(text)?60:0;
  return 0;};
 const focus=new Set(analysis.cv_focus_fact_ids??analysis.matched_fact_ids??[]);
 const ranked=facts.map(fact=>({fact,score:exactScore(fact)*10+strength(fact)+(focus.has(fact.id)?15:0),core:strength(fact),exact:exactScore(fact)})).sort((a,b)=>b.score-a.score);
 const narrative=ranked.filter(item=>item.fact.provenance&&item.fact.provenance!=='COURSE');
 const bestExact=Math.max(0,...narrative.map(item=>item.exact));
 const primaryRows=narrative.filter(item=>bestExact?item.exact>0:item.core>=70);
 const primary=(primaryRows.length?primaryRows:narrative.slice(0,2)).map(item=>item.fact.id);
 const sections=ranked.filter(item=>item.fact.provenance&&!['EDUCATION','COURSE'].includes(item.fact.provenance));
 const focused=family==='GENERAL'&&!bestExact||!primary.length?sections.slice(0,4):sections.filter(item=>item.exact>0||item.core>=(family==='IT_SUPPORT'?70:1)).slice(0,4);
 const breadth=sections.filter(item=>/turbo.?jet|turbojet|cycloidal|cykloid|cycloid/i.test([item.fact.title,...(item.fact.statements??[])].join(' ')));
 const selected=[...focused,...breadth,...sections.filter(item=>item.fact.provenance==='PROFESSIONAL'),...sections.filter(item=>item.fact.provenance!=='PROFESSIONAL'&&!focused.includes(item)).slice(0,1)].filter((item,i,all)=>all.findIndex(other=>other.fact.id===item.fact.id)===i).slice(0,6);
 const target=normalize(`${job.title??''} ${job.description_text??''}`);
 const relevantTraining=facts.filter(fact=>fact.provenance==='COURSE'&&(family==='GENERAL'||strength(fact)>=70
  ||(normalize(fact.title).match(/python|\bcad\b|\bplc\b|linux|machine learning|data science/g)??[]).some(term=>target.includes(term)))).map(fact=>fact.id);
 return {family,primary_fact_ids:primary,ranked_fact_ids:ranked.map(item=>item.fact.id),allowed_section_ids:selected.map(item=>item.fact.id),
  preferred_section_ids:selected.map(item=>item.fact.id),required_project_ids:breadth.map(item=>item.fact.id),secondary_fact_ids:selected.filter(item=>!focused.includes(item)).map(item=>item.fact.id),engineering_education_first:['MECHANICAL','ENGINEERING_AUTOMATION'].includes(family),
  relevant_training_ids:relevantTraining,
  vacancy_keywords:vacancyKeywords,
  scores:Object.fromEntries(ranked.map(item=>[item.fact.id,item.exact*10+item.core]))};
}
export function cvTailoringQa(document,profile,analysis={},job={}){
 const plan=cvTailoringPlan(profile,analysis,job),errors=[],keywordCoverage=cvKeywordCoverage(document,profile,plan);
 if(keywordCoverage.some(entry=>entry.status==='SUPPORTED_NOT_COVERED'))errors.push('SUPPORTED_ATS_KEYWORDS_MISSING');
 if(keywordCoverage.some(entry=>entry.status==='UNSUPPORTED_KEYWORD_CLAIMED'))errors.push('UNSUPPORTED_ATS_KEYWORD_CLAIMED');
 if(plan.vacancy_keywords.hard_missing_requirements.length)errors.push('UNSUPPORTED_STRICT_MANDATORY_QUALIFICATION');
 if(!plan.primary_fact_ids.length)return {pass:errors.length===0,errors,family:plan.family,keyword_coverage:keywordCoverage,target_requirements_hash:plan.vacancy_keywords.requirements_hash};
 const primary=new Set(plan.primary_fact_ids),aligned=claim=>claim.source_fact_ids?.some(id=>primary.has(id));
 if(!aligned(document.headline))errors.push('HEADLINE_PRIMARY_EVIDENCE_REQUIRED');
 const head=normalize(document.headline.text);
 if(plan.engineering_education_first&&!engineeringTerms.test(head))errors.push('ENGINEERING_HEADLINE_REQUIRED');
 if(!document.summary.length||!aligned(document.summary[0]))errors.push('SUMMARY_TARGET_EVIDENCE_FIRST');
 const total=document.summary.reduce((n,c)=>n+c.text.split(/\s+/).length,0),relevant=document.summary.filter(aligned).reduce((n,c)=>n+c.text.split(/\s+/).length,0);
 if(relevant<total*.5)errors.push('SUMMARY_UNRELATED_DOMINANCE');
 const index=factIndex(profile);
 for(const id of plan.required_project_ids)if(!document.sections.some(section=>section.source_fact_id===id))errors.push('CONFIRMED_PROJECT_BREADTH_MISSING');
 for(const summary of document.summary){const scopes=new Set(summary.source_fact_ids.map(id=>index.get(id)?.provenance));
  const text=normalize(summary.text);
  if(scopes.has('ACADEMIC')&&!/academic|akademick/.test(text)||scopes.has('PERSONAL_PROJECT')&&!/personal|projekt.*wlasn/.test(text)
   ||scopes.has('INDEPENDENT_R_AND_D')&&!/independent|niezalezn/.test(text))errors.push('SUMMARY_PROVENANCE_LABEL_REQUIRED');
 }
 const strongest=Math.max(0,...plan.allowed_section_ids.map(id=>plan.scores[id]??0));
 if(document.sections.length&&((plan.scores[document.sections[0].source_fact_id]??0)<strongest||document.sections.some(section=>!plan.allowed_section_ids.includes(section.source_fact_id))))errors.push('TARGET_SECTION_ORDER_OR_SELECTION');
 const skillAligned=claim=>cvSkillRelevance(claim.text,plan.family)>0||plan.vacancy_keywords.entries.some(entry=>entry.status==='SUPPORTED'&&entry.aliases.some(term=>hasKeyword(claim.text,term)));
 const top=document.skills.slice(0,5);if(top.length&&top.filter(skillAligned).length<Math.ceil(top.length*.6))errors.push('TOP_SKILLS_UNRELATED_DOMINANCE');
 return {pass:errors.length===0,errors,family:plan.family,primary_fact_ids:plan.primary_fact_ids,summary_primary_word_ratio:total?relevant/total:0,
  keyword_coverage:keywordCoverage,target_requirements_hash:plan.vacancy_keywords.requirements_hash};
}
export function cvKeywordCoverage(document,profile,plan){const claims=cvClaimCatalog(document),index=factIndex(profile);
 const deterministicIds=[...(profile.education??[]).map(f=>f.id),...(profile.languages??[]).map(f=>f.id),...plan.relevant_training_ids];
 return plan.vacancy_keywords.entries.map(entry=>{const cited=claims.filter(claim=>entry.aliases.some(term=>hasKeyword(claim.text,term))
   &&claim.source_fact_ids.some(id=>entry.source_fact_ids.includes(id)));
  const deterministic=deterministicIds.filter(id=>entry.source_fact_ids.includes(id)&&entry.aliases.some(term=>hasKeyword(JSON.stringify(index.get(id)),term)));
  const unsupportedMention=entry.status!=='SUPPORTED'&&claims.some(claim=>entry.aliases.some(term=>hasKeyword(claim.text,term)));
  return {...entry,status:entry.status==='SUPPORTED'?(cited.length||deterministic.length?'SUPPORTED_COVERED':'SUPPORTED_NOT_COVERED')
   :unsupportedMention?'UNSUPPORTED_KEYWORD_CLAIMED':'UNSUPPORTED_DO_NOT_CLAIM',covered_claim_ids:cited.map(claim=>claim.claim_id),deterministic_fact_ids:deterministic};});
}
export function selectCatalog(profile, analysis, job) {
  const index = factIndex(profile);
  const tailoring=cvTailoringPlan(profile,analysis,job),order=new Map(tailoring.ranked_fact_ids.map((id,n)=>[id,n]));
  const focus = new Set(analysis?.cv_focus_fact_ids ?? analysis?.matched_fact_ids ?? []);
  const vacancy = normalize(`${job.title ?? ''} ${job.description_text ?? ''} ${analysis?.role_family ?? ''}`);
  const score = fact => (focus.has(fact.id) ? 100 : 0) + (fact.skills ?? []).reduce((n,skill) => n + (vacancy.includes(normalize(skill)) ? 5 : 0),0);
  const facts = [...index.values()].sort((a,b) => tailoring.family==='GENERAL'?score(b)-score(a):order.get(a.id)-order.get(b.id)).map(cleanFact);
  const skillMap = new Map();
  for (const fact of facts) for (const rawSkill of fact.skills ?? []) {
    const skill=cappedSkill(rawSkill,profile);
    // Preserve qualifiers: "Linux familiarity" cannot become "Linux expert".
    const key = normalize(skill);
    if (!skillMap.has(key)) skillMap.set(key,{text:skill.replace(/_/g,' '), source_fact_ids:[]});
    skillMap.get(key).source_fact_ids.push(fact.id);
  }
  const keywordScore=skill=>tailoring.vacancy_keywords.entries.filter(entry=>entry.status==='SUPPORTED'&&entry.aliases.some(term=>hasKeyword(skill.text,term))&&!(tailoring.family==='SOFTWARE'&&/^automation$/i.test(entry.keyword)&&cvSkillRelevance(skill.text,'SOFTWARE')===0)).reduce((n,entry)=>n+entry.weight,0);
  const relevance=skill=>keywordScore(skill)*10+cvSkillRelevance(skill.text,tailoring.family);
  return {index, facts,tailoring,skills:[...skillMap.values()].filter(skill=>relevance(skill)>0).sort((a,b) => relevance(b)-relevance(a)||Number(vacancy.includes(normalize(b.text)))-Number(vacancy.includes(normalize(a.text))))};
}

export function cvWriterSchema(profile,{allowedSectionIds,allowedSkillNames}={}) {
  const facts = [...factIndex(profile).values()];
  if (!facts.length) throw new Error('CV requires verified candidate facts');
  const ids = facts.map(f => f.id);
  const claim = obj({text:{type:'string', minLength:1, maxLength:550}, source_fact_ids:{type:'array', minItems:1, maxItems:6, uniqueItems:true, items:{enum:ids}}});
  const skillNames = [...new Set(facts.flatMap(f => f.skills ?? []).map(s => cappedSkill(s,profile)))].filter(text=>!allowedSkillNames||allowedSkillNames.includes(text));
  const skill = structuredClone(claim);
  skill.properties.text = skillNames.length ? {enum:skillNames} : {type:'string', maxLength:0};
  const skillSchema=skillNames.length ? {oneOf:skillNames.map(text=>{
    const supportedIds=facts.filter(f=>(f.skills??[]).some(s=>cappedSkill(s,profile)===text)).map(f=>f.id);
    return obj({text:{const:text},source_fact_ids:{type:'array',minItems:1,maxItems:Math.min(6,supportedIds.length),uniqueItems:true,items:{enum:supportedIds}}});
  })} : skill;
  const sectionIds = facts.filter(f => f.provenance && !['EDUCATION','COURSE'].includes(f.provenance)&&(!allowedSectionIds||allowedSectionIds.includes(f.id))).map(f => f.id);
  const sectionSchema=sectionIds.length ? {oneOf:sectionIds.map(id=>{
    const bullet=structuredClone(claim);
    bullet.properties.source_fact_ids={type:'array',minItems:1,maxItems:1,items:{const:id}};
    return obj({source_fact_id:{const:id},bullets:{...array(bullet,4),minItems:1}});
  })} : obj({source_fact_id:str,bullets:{...array(claim,3),minItems:1}});
  return obj({headline:claim, summary:{...array(claim,2),minItems:1}, skills:{...array(skillSchema,14), ...(skillNames.length ? {minItems:1} : {maxItems:0})},
    sections:{...array(sectionSchema,6), ...(sectionIds.length ? {minItems:1} : {maxItems:0})},
    application_text:array(obj({kind:{enum:['cover_letter','motivation','introduction']}, claims:{...array(claim,3), minItems:1}}),1)});
}

export function cvClaimCatalog(document) {
  const claims = [];
  const add = (claim,kind,extra={}) => claims.push({claim_id:`claim_${claims.length}`,kind,...claim,...extra});
  add(document.headline,'headline');
  document.summary.forEach(c => add(c,'summary'));
  document.skills.forEach(c => add(c,'skill'));
  document.sections.forEach(section => section.bullets.forEach(c => add(c,'bullet',{section_fact_id:section.source_fact_id})));
  document.application_text.forEach(text => text.claims.forEach(c => add(c,text.kind)));
  return claims;
}

// A fail-closed complement to the semantic verifier. These checks are applied
// to each cited evidence bundle, never the whole profile or vacancy description.
export function deterministicCvQa(document, profile) {
  const index = factIndex(profile);
  const errors = [];
  const technologies = ['Python','React','Django','JavaScript','TypeScript','Java','C++','C#','SQL','PostgreSQL','Docker','Kubernetes','AWS','Azure','GCP','TensorFlow','PyTorch','Linux','Windows','Active Directory','Fusion 360','SolidWorks','CATIA','ANSYS','FLOW-3D','PLC','Arduino','ESP32','PID','FEA','CFD','HTML','CSS','REST','D3D12'];
  const contains = (text,term) => new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^a-z0-9]|$)`,'i').test(text);
  const seniority = /\b(senior|lead|principal|expert|manager|director|starszy|ekspert|kierownik)\b/i;
  const professionalClaim = /\b(professional|commercial|employment|employed|zawodow\w*|komercyjn\w*)\b/i;
  for (const claim of cvClaimCatalog(document)) {
    const cited = claim.source_fact_ids.map(id => index.get(id)).filter(Boolean);
    const error = reason => errors.push({claim_id:claim.claim_id, reason});
    if (cited.length !== claim.source_fact_ids.length || !cited.length) {error('INVALID_FACT_IDS'); continue;}
    const source = normalize(JSON.stringify(cited.map(f=>Object.fromEntries(Object.entries(cleanFact(f)).filter(([key])=>key!=='id')))));
    const text = normalize(claim.text);
    if (/UNKNOWN|\{\{|TODO|PLACEHOLDER/.test(claim.text)) error('PLACEHOLDER');
    const standaloneNumbers=value=>(value.match(/(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?(?![\p{L}\p{N}])/gu)??[]).map(n=>n.replace(',','.'));
    const sourceNumbers=new Set(standaloneNumbers(source));
    for (const number of standaloneNumbers(text)) if (!sourceNumbers.has(number)) error(`UNSUPPORTED_NUMBER:${number}`);
    for (const term of technologies) if (contains(text,normalize(term)) && !contains(source,normalize(term))) error(`UNSUPPORTED_SKILL:${term}`);
    if (seniority.test(text) && !seniority.test(source)) error('SENIORITY_INFLATION');
    if (professionalClaim.test(text) && !cited.some(f => f.provenance === 'PROFESSIONAL')) error('PROVENANCE_INFLATION');
    const scopePatterns={ACADEMIC:/\bacademic\b|\bakademick\w*\b/i,PERSONAL_PROJECT:/\bpersonal\b|\bprojekt\w* wlasn\w*\b/i,INDEPENDENT_R_AND_D:/\bindependent (?:r&d|research)|\bniezalezn\w* (?:badania|badan)/i};
    const declaredScopes=Object.entries(scopePatterns).filter(([,pattern])=>pattern.test(text)).map(([p])=>p);
    if(declaredScopes.length) for(const f of cited.filter(f=>['ACADEMIC','PERSONAL_PROJECT','INDEPENDENT_R_AND_D'].includes(f.provenance)))
      if(!declaredScopes.includes(f.provenance))error('RESEARCH_PROJECT_SCOPE_MISMATCH');
    if (claim.section_fact_id && (!claim.source_fact_ids.includes(claim.section_fact_id) || claim.source_fact_ids.some(id => index.get(id)?.provenance !== index.get(claim.section_fact_id)?.provenance))) error('SECTION_PROVENANCE_MISMATCH');
    const inProgress = cited.some(f => f.status === 'degree_in_progress');
    for (const degreeType of [/\b(?:bachelor(?:'s)?|bsc|beng|licencjat)\b/i,/\b(?:master(?:'s)? degree|msc|meng|magister)\b/i,/\b(?:phd|doctorate|doktorat)\b/i])
      if (degreeType.test(text) && !degreeType.test(source)) error('UNSUPPORTED_DEGREE_LEVEL');
    if (inProgress && /\b(graduated|completed degree|bachelor|master|bsc|msc|absolwent|ukonczyl\w*|magister)\b/i.test(text) && !/\b(in progress|studying|student|ongoing|pursuing|w toku|studiuj\w*)\b/i.test(text)) error('DEGREE_STATUS_INFLATION');
    if (claim.kind === 'skill' && !cited.some(f => (f.skills ?? []).some(s => normalize(cappedSkill(s,profile)) === text))) error('UNSUPPORTED_SKILL_LABEL');
    if(claim.kind==='skill'&&/^c\+\+$/.test(text)&&cappedSkill('C++',profile)!=='C++')error('CPP_QUALIFIER_REQUIRED');
    // All named employers/institutions from the profile must use their own IDs.
    for (const fact of index.values()) for (const field of ['employer','organization','institution']) if (known(fact[field]) && text.includes(normalize(fact[field])) && !source.includes(normalize(fact[field]))) error('UNSUPPORTED_EMPLOYER');
    // New employment-at-X claims are not allowed by lexical evidence alone.
    const employers = [...text.matchAll(/\b(?:employed (?:at|by)|worked at|working at|praca w|zatrudnion\w* w)\s+([^.;,]+)/g)].map(m=>m[1].trim());
    for (const employer of employers) if (!cited.some(f => ['employer','organization','environment'].some(field => known(f[field]) && normalize(f[field]) === employer))) error('UNSUPPORTED_EMPLOYER');
    for (const years of [...text.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(?:years?|lat|lata)\b/gi)]) {
      const duration=Number(years[1].replace(',','.'));
      if (!cited.some(f => f.provenance === 'PROFESSIONAL' && Number(f.duration_approx_years) === duration)) error('UNSUPPORTED_PROFESSIONAL_YEARS');
      else if (!/\b(approximately|about|around|roughly|okolo)\b/i.test(text)) error('APPROXIMATE_YEARS_AS_EXACT');
    }
  }
  const sectionIds = document.sections.map(s=>s.source_fact_id);
  if(document.application_text.some(t=>t.claims.map(c=>c.text).join(' ').split(/\s+/).length>150))errors.push({claim_id:null,reason:'APPLICATION_TEXT_TOO_LONG'});
  if (new Set(sectionIds).size !== sectionIds.length) errors.push({claim_id:null,reason:'DUPLICATE_SECTION'});
  return {pass:errors.length === 0, errors};
}

export async function verifyCvEntailment(document, profile, llm) {
  const index = factIndex(profile);
  const claims = cvClaimCatalog(document);
  const allChecks=[];const batches=[];
  // Bounded evidence bundles preserve attention to the actual presentation
  // context and avoid asking a small verifier to track a long duplicate corpus.
  for(let offset=0;offset<claims.length;offset+=6) {
    const batch=claims.slice(offset,offset+6);
    const schema = obj({checks:{type:'array', minItems:batch.length, maxItems:batch.length,
      items:obj({claim_id:{enum:batch.map(c=>c.claim_id)}, verdict:{enum:['SUPPORTED','UNSUPPORTED','UNCERTAIN']}, reason:{type:'string',maxLength:180}})}});
    const verifierSystem=await readFile(new URL('../../prompts/cv_verify_v2.md',import.meta.url),'utf8');
    const checks = await llm.json({strong:false, numPredict:1800, schema,
      system:verifierSystem,
      prompt:JSON.stringify({verification_date:new Date().toISOString().slice(0,10),verified_skill_null_provenance_means_no_employment_scope:true,evidence_bundles:batch.map(c=>({...c,
      presentation_scope:c.kind==='bullet' ? index.get(c.section_fact_id)?.provenance : c.kind==='skill' ? 'VERIFIED_SKILL_NO_EMPLOYMENT_OR_EXPERTISE_IMPLIED' : 'CANDIDATE_PROFILE_WITH_SOURCE_PROVENANCE',
      source_facts:c.source_fact_ids.map(id=>cleanFact(index.get(id)))}))}),
      repairInstruction:'Return one check for EVERY supplied claim ID exactly once. Judge the actual presentation_scope, not an invented employment scope. Reject additions, lost qualifiers and changed provenance.',
      validate:result=>{const ids=result.checks.map(c=>c.claim_id); if (new Set(ids).size !== batch.length || batch.some(c=>!ids.includes(c.claim_id))) throw new StructuredOutputError('Entailment verifier omitted or duplicated claim IDs');}});
    if (!ajv.compile(schema)(checks) || new Set(checks.checks.map(c=>c.claim_id)).size!==batch.length || batch.some(c=>!checks.checks.some(check=>check.claim_id===c.claim_id)))
      throw new StructuredOutputError('Entailment verifier malformed, omitted or duplicated claim IDs');
    allChecks.push(...checks.checks);batches.push({claim_ids:batch.map(c=>c.claim_id),prompt_sha256:hash(verifierSystem),stats:structuredClone(llm.lastStats??null)});
  }
  return {pass:allChecks.every(c=>c.verdict==='SUPPORTED'), model:llm.model ?? 'injected-gateway', checks:allChecks,batches};
}

export function renderCvV2Html(document, profile, language, identity,tailoring=null) {
  const pl = language === 'Polish';
  const labels = pl ? {summary:'Profil', skills:'Umiejętności', experience:'Doświadczenie zawodowe', projects:'Projekty i badania', education:'Wykształcenie', training:'Kursy',languages:'Języki'} : {summary:'Profile', skills:'Skills', experience:'Professional experience', projects:'Projects and research', education:'Education',training:'Training',languages:'Languages'};
  const provenance = pl ? {PROFESSIONAL:'Doświadczenie zawodowe',ACADEMIC:'Projekt akademicki',PERSONAL_PROJECT:'Projekt własny',INDEPENDENT_R_AND_D:'Niezależne badania i rozwój'} : {PROFESSIONAL:'Professional work',ACADEMIC:'Academic project',PERSONAL_PROJECT:'Personal project',INDEPENDENT_R_AND_D:'Independent research and development'};
  const index=factIndex(profile);
  const claims=list=>`<ul>${list.map(c=>`<li>${escape(c.text)}</li>`).join('')}</ul>`;
  const sectionHtml=sections=>sections.map(s=>{const f=index.get(s.source_fact_id); const metadata=[f.employer,f.organization,f.environment].filter(known);
    const dates=[f.exact_start_date ?? f.start_date,f.exact_end_date ?? (f.status==='ongoing' ? (pl?'obecnie':'present'):null)].filter(known).join(' – ');
    return `<article><h3>${escape(f.role ?? f.title)}</h3><p class="meta">${escape([provenance[f.provenance],...metadata,dates].filter(Boolean).join(' · '))}</p>${claims(s.bullets)}</article>`;}).join('');
  const employed=document.sections.filter(s=>index.get(s.source_fact_id).provenance==='PROFESSIONAL');
  const projects=document.sections.filter(s=>index.get(s.source_fact_id).provenance!=='PROFESSIONAL');
  const professionalHtml=employed.length?`<h2>${labels.experience}</h2>${sectionHtml(employed)}`:'';
  const projectHtml=projects.length?`<h2>${labels.projects}</h2>${sectionHtml(projects)}`:'';
  const prioritizedSections=document.sections[0] && index.get(document.sections[0].source_fact_id).provenance!=='PROFESSIONAL' ? projectHtml+professionalHtml : professionalHtml+projectHtml;
  const education=(profile.education??[]).map(f=>`<article><h3>${escape(f.institution)}</h3><p>${escape([f.degree,f.field,f.specialization].filter(known).join(' · '))}</p><p>${escape(f.status==='degree_in_progress' ? (pl?'Studia w toku':'Degree in progress') : f.status)}</p>${known(f.start_date)?`<p class="meta">${escape(f.start_date)} — ${pl?'obecnie':'ongoing'}</p>`:''}${Number.isInteger(f.semesters_completed)?`<p>${escape(f.semesters_completed)} ${pl?'ukończonych semestrów':'semesters completed'}</p>`:''}</article>`).join('');
  const training=(profile.training??[]).filter(f=>!tailoring||tailoring.relevant_training_ids.includes(f.id)).map(f=>`<p>${escape(f.title)}${known(f.provider)?` · ${escape(f.provider)}`:''}${f.certificate?` · ${pl?'certyfikat kursu':'course certificate'}`:''}</p>`).join('');
  const contacts=[identity.email,identity.phone,profile.onboarding?.github_url,profile.onboarding?.portfolio_url].filter(known);
  const location=[profile.candidate?.base_location?.city,profile.candidate?.base_location?.country].filter(known).join(', ');
  const educationHtml=education?`<h2>${labels.education}</h2>${education}`:'';
  const body=tailoring?.engineering_education_first?educationHtml+prioritizedSections:prioritizedSections+educationHtml;
  return `<!doctype html><html lang="${pl?'pl':'en'}"><meta charset="utf-8"><style>${CV_STYLE}</style><body>${identity.name?`<h1>${escape(identity.name)}</h1>`:''}<p class="headline">${escape(document.headline.text)}</p>${contacts.length?`<p class="contacts">${contacts.map(escape).join(' · ')}</p>`:''}${location?`<p class="meta">${escape(location)}</p>`:''}<h2>${labels.summary}</h2>${document.summary.map(c=>`<p>${escape(c.text)}</p>`).join('')}<h2>${labels.skills}</h2><p>${document.skills.map(c=>escape(c.text)).join(' · ')}</p>${body}${training?`<h2>${labels.training}</h2>${training}`:''}<h2>${labels.languages}</h2><p>${(profile.languages??[]).map(l=>`${escape(l.language)} — ${escape(l.level)}`).join(' · ')}</p></body></html>`;
}
const CV_STYLE = readFileSync(new URL('./templates/cv-v2.css',import.meta.url),'utf8');

async function renderPdf(html, target) {
  const browser=await chromium.launch({headless:true,args:['--disable-gpu']});
  try {const page=await browser.newPage(); await page.setContent(html,{waitUntil:'load'}); await page.emulateMedia({media:'print'});
    const visual=await page.evaluate(()=>({no_horizontal_overflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth,
      headings_visible:[...document.querySelectorAll('h1,h2,h3')].every(e=>e.getBoundingClientRect().width>0 && getComputedStyle(e).fontSize!=='0px')}));
    await page.pdf({path:target,format:'A4',printBackground:true});
    return visual;
  } finally {await browser.close();}
}

export async function buildTailoredCv({job,profile,analysis,llm=new OllamaClient(),repository,outputRoot='data/cv-v2',writerMode=process.env.CV_WRITER_MODE??'auto',allowUnverifiedSource=false}) {
  if(analysis?.fit_complete===false||analysis?.cv_eligible===false||analysis?.location_policy_status==='UNVERIFIED')throw new Error('FIT_LOCATION_NOT_RESOLVED_CV_FORBIDDEN');
  const totalStarted=performance.now();
  llm=resolveCvLlm(llm);
  if (job.availability_status==='CLOSED'||job.availability_status!=='OPEN'&&!allowUnverifiedSource) throw new Error('Vacancy not verified OPEN');
  const catalog=selectCatalog(profile,analysis,job);
  const language=/^(pl|polish)$/i.test(job.language ?? job.metadata?.language ?? '') ? 'Polish' : 'English';
  const applicationRequested=Boolean(job.metadata?.cover_letter_required || job.metadata?.motivation_required || analysis?.application_text_requested);
  const identity=cvIdentityQa(profile);
  const rejected=analysis?.decision==='REJECT';
  const cvId=randomUUID();
  const dir=path.resolve(outputRoot,new Date().toISOString().slice(0,7),safeSlug(job.company),safeSlug(job.job_id),cvId);
  await mkdir(dir,{recursive:true});
  const profileHash=hash(JSON.stringify(profile));
  const manifest={cv_id:cvId,job_id:job.job_id,status:'BLOCKED_CLAIMS',profile_version:profileHash,profile_hash:profileHash,template_version:CV_V2_VERSION,
    job_content_hash:job.content_hash??hash(job.description_text??''),
    analysis_hash:canonicalAnalysisHash(analysis),analysis_input_hash:analysis?.fit_input_hash??null,
    operation_run_id:operationContext.getStore()?.run_id??null,
    analysis_prompt_version:analysis?.prompt_version??null,
    source_decision:analysis?.decision ?? null,source_verification_required:job.availability_status!=='OPEN',application_eligible:job.availability_status==='OPEN'&&!rejected && ['AUTO_APPLY','REVIEW','STRETCH'].includes(analysis?.decision),
    language,model:llm.strongModel ?? llm.model ?? 'injected-gateway',verifier_model:llm.model ?? 'injected-gateway',created_at:new Date().toISOString(),
    pdf_path:null,html_path:null,document_path:null,source_map_path:path.join(dir,'source-fact-map.json'),manifest_path:path.join(dir,'manifest.json'),
    qa:{pass:false,claims:{pass:false},identity:{pass:identity.pass,status:identity.status,missing:identity.missing},pdf:{pass:false,status:'NOT_RENDERED'}}};
  let document,extractiveProof;
  try {
    if(catalog.tailoring.vacancy_keywords.hard_missing_requirements.length){manifest.application_eligible=false;manifest.application_policy_blocker='UNSUPPORTED_STRICT_MANDATORY_QUALIFICATION';throw new StructuredOutputError('Unsupported strict mandatory qualification blocks CV generation');}
    const schema=cvWriterSchema(profile,{allowedSectionIds:catalog.tailoring.allowed_section_ids,allowedSkillNames:catalog.skills.map(skill=>skill.text)});
    const validate=ajv.compile(schema);
    const writerStarted=performance.now();
    const writerSystem=await readFile(new URL('../../prompts/cv_writer_v2.md',import.meta.url),'utf8');manifest.writer_prompt_sha256=hash(writerSystem);
    if(repository?.pool)await observe(repository,{event:'CV_WRITER_STARTED',entity_type:'job',entity_id:job.job_id,message:'Grounded CV writer running',model:manifest.model});
    if(writerMode==='extractive'||writerMode==='auto'&&llm instanceof OllamaClient){
      const candidate=composeExtractiveCv({catalog,job});
      const sourceProof=candidate&&verifyExtractiveCv(candidate,profile,catalog.skills);
      const target=candidate&&cvTailoringQa(candidate,profile,analysis,job);
      if(language==='English'&&!applicationRequested&&candidate&&validate(candidate)&&sourceProof.pass&&target.pass&&deterministicCvQa(candidate,profile).pass){document=candidate;extractiveProof=sourceProof;manifest.generation_method='EXTRACTIVE_VACANCY_TAILORING';manifest.model='SOURCE_FACT_COMPOSER';manifest.verifier_model='EXACT_SOURCE_PROOF';}
      else {manifest.fast_path_fallback={language,applicationRequested,tailoring:target?.errors??[],schema:validate.errors??[],claims:candidate?deterministicCvQa(candidate,profile).errors:[]};if(writerMode==='extractive')throw new Error('EXTRACTIVE_CV_REQUIRES_FALLBACK');}
    }
    if(!document)document=await llm.json({strong:true,numPredict:5000,schema,system:writerSystem,
      prompt:JSON.stringify({current_date:new Date().toISOString().slice(0,10),language,application_text_requested:applicationRequested,target:{title:job.title,description:job.description_text,role_family:analysis?.role_family},
        exact_requirements:analysis?.requirements??[],tailoring_plan:catalog.tailoring,priority_fact_ids:catalog.tailoring.primary_fact_ids,facts:catalog.facts.map(writerFact),allowed_skills:catalog.skills}),
      repairInstruction:'Use only supplied source IDs and supported facts. Keep provenance, qualifiers and degree status. No seniority or skills inferred from target title. Fix unsupported claims.',
      validate:value=>{if (!validate(value)) throw new StructuredOutputError('CV writer schema invalid');
        const tailoring=cvTailoringQa(value,profile,analysis,job);if(!tailoring.pass)throw new StructuredOutputError(`CV target tailoring: ${tailoring.errors.join(', ')}`);
        if (!applicationRequested && value.application_text.length) throw new StructuredOutputError('Unrequested application text');
        const qa=deterministicCvQa(value,profile); if (!qa.pass) throw new StructuredOutputError(`CV deterministic fact guards: ${qa.errors.map(e=>e.reason).join(', ')}`);}});
    if (!validate(document)) {document=undefined; throw new StructuredOutputError('CV writer schema invalid');}
    if (!applicationRequested && document.application_text.length) throw new StructuredOutputError('Unrequested application text');
    manifest.writer_stats=extractiveProof?{model_requests:0}:structuredClone(llm.lastStats??null);manifest.writer_duration_ms=Math.round(performance.now()-writerStarted);
    if(repository?.pool)await observe(repository,{event:'CV_WRITER_COMPLETED',entity_type:'job',entity_id:job.job_id,message:'CV writer completed; checking independent entailment',model:manifest.model,model_requests:llm.lastStats?.semantic_attempts});
    const deterministic=deterministicCvQa(document,profile);
    const tailoring=cvTailoringQa(document,profile,analysis,job);manifest.qa.tailoring=tailoring;
    manifest.keyword_coverage={job_id:catalog.tailoring.vacancy_keywords.job_id,job_content_hash:catalog.tailoring.vacancy_keywords.job_content_hash,
      requirements_hash:catalog.tailoring.vacancy_keywords.requirements_hash,source_catalog_hash:catalog.tailoring.vacancy_keywords.source_catalog_hash,entries:tailoring.keyword_coverage};
    const verifierStarted=performance.now();
    if(repository?.pool)await observe(repository,{event:'CV_VERIFIER_STARTED',entity_type:'job',entity_id:job.job_id,message:'Independent CV entailment verifier running',model:manifest.verifier_model});
    const semantic=extractiveProof??await verifyCvEntailment(document,profile,llm);
    manifest.verifier_stats=extractiveProof?{model_requests:0}:structuredClone(llm.lastStats??null);manifest.verifier_duration_ms=Math.round(performance.now()-verifierStarted);
    if(repository?.pool)await observe(repository,{event:'CV_VERIFIER_COMPLETED',entity_type:'job',entity_id:job.job_id,message:semantic.pass?'Every CV claim supported':'CV claims blocked by independent verifier',claims_pass:semantic.pass,model:manifest.verifier_model,model_requests:llm.lastStats?.semantic_attempts});
    manifest.qa.claims={pass:deterministic.pass && semantic.pass&&tailoring.pass,deterministic,semantic};
    manifest.document_path=path.join(dir,'cv.json');
    manifest.html_path=path.join(dir,'cv.html');
    const html=renderCvV2Html(document,profile,language,identity.identity,catalog.tailoring);
    await writeFile(manifest.document_path,JSON.stringify({...document,target_job_id:job.job_id,language,identity:identity.identity},null,2));
    await writeFile(manifest.html_path,html);
    manifest.status=!manifest.qa.claims.pass ? 'BLOCKED_CLAIMS' : !identity.pass ? 'BLOCKED_IDENTITY' : 'BLOCKED_PDF';
    if (manifest.qa.claims.pass && identity.pass && !rejected) {
      const renderStarted=performance.now();
      const pdfPath=path.join(dir,'cv.pdf');
      const visual=await renderPdf(html,pdfPath);
      const buffer=await readFile(pdfPath); const parser=new PDFParse({data:buffer});
      let parsed; let raster;
      try {parsed=await parser.getText(); raster=await parser.getScreenshot({desiredWidth:1100,imageBuffer:true,imageDataUrl:false});} finally {await parser.destroy();}
      const previewPaths=[];
      for (const page of raster.pages) {const previewPath=pdfPath.replace(/\.pdf$/,`.page-${page.pageNumber}.png`); await writeFile(previewPath,page.data); previewPaths.push(previewPath);}
      const pdfQa={nonempty:buffer.length>0,name_present:parsed.text.includes(identity.identity.name),contacts_present:[identity.identity.email,identity.identity.phone].every(v=>parsed.text.includes(v)),
        no_placeholders:!/(?:UNKNOWN|\{\{|TODO|PLACEHOLDER)/.test(parsed.text),page_count:parsed.total,visual_sanity:visual,preview_paths:previewPaths,
        pdf_pages_rendered:raster.pages.length===parsed.total && raster.pages.every(p=>p.width>0 && p.height>0 && p.data.length>100)};
      pdfQa.pass=pdfQa.nonempty && pdfQa.name_present && pdfQa.contacts_present && pdfQa.no_placeholders && parsed.total>=1 && parsed.total<=2 && Object.values(visual).every(Boolean) && pdfQa.pdf_pages_rendered;
      manifest.qa.pdf=pdfQa;manifest.render_and_pdf_qa_duration_ms=Math.round(performance.now()-renderStarted);
      manifest.pdf_path=pdfPath; manifest.sha256=hash(buffer);
      manifest.status=pdfQa.pass ? 'PASS' : 'BLOCKED_PDF';
    }
  } catch (error) {manifest.qa.error={code:error.name,message:error.message};}
  if (rejected) {manifest.content_status=manifest.status;manifest.status='REJECTED_DIAGNOSTIC_CONTENT';manifest.application_eligible=false;}
  manifest.qa.pass=manifest.status==='PASS';manifest.total_duration_ms=Math.round(performance.now()-totalStarted);
  await writeFile(manifest.source_map_path,JSON.stringify({profile_version:manifest.profile_version,profile_hash:manifest.profile_hash,
    job_content_hash:manifest.job_content_hash,analysis_hash:manifest.analysis_hash,analysis_input_hash:manifest.analysis_input_hash,claims:document?cvClaimCatalog(document):[],
    deterministic_sections:{education:(profile.education??[]).map(f=>f.id),training:catalog.tailoring.relevant_training_ids,languages:(profile.languages??[]).map(f=>f.id),
      metadata:document?document.sections.map(s=>({source_fact_id:s.source_fact_id,fields:['role','title','employer','organization','environment','provenance','start_date','exact_start_date','exact_end_date','status']})):[]},facts:catalog.facts},null,2));
  await writeFile(manifest.manifest_path,JSON.stringify(manifest,null,2));
  if (repository?.recordCvDraft) await repository.recordCvDraft(manifest);
  return manifest;
}
