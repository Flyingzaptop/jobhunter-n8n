import {randomUUID, createHash} from 'node:crypto';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import {chromium} from 'playwright';
import {PDFParse} from 'pdf-parse';
import {factIndex} from './fit.mjs';
import {OllamaClient, StructuredOutputError} from './llm.mjs';
import {observe,operationContext} from './observability.mjs';

export const CV_V2_VERSION = 'cv-factory-v2.1';
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
  return new OllamaClient({baseUrl:original.baseUrl,timeoutMs:original.timeoutMs,fetchImpl:original.fetch,
    model:environment.CV_VERIFIER_MODEL||original.model,strongModel:environment.CV_WRITER_MODEL||original.strongModel});
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

function selectCatalog(profile, analysis, job) {
  const index = factIndex(profile);
  const focus = new Set(analysis?.cv_focus_fact_ids ?? analysis?.matched_fact_ids ?? []);
  const vacancy = normalize(`${job.title ?? ''} ${job.description_text ?? ''} ${analysis?.role_family ?? ''}`);
  const score = fact => (focus.has(fact.id) ? 100 : 0) + (fact.skills ?? []).reduce((n,skill) => n + (vacancy.includes(normalize(skill)) ? 5 : 0),0);
  const facts = [...index.values()].sort((a,b) => score(b)-score(a)).map(cleanFact);
  const skillMap = new Map();
  for (const fact of facts) for (const rawSkill of fact.skills ?? []) {
    const skill=skillText(rawSkill);
    // Preserve qualifiers: "Linux familiarity" cannot become "Linux expert".
    const key = normalize(skill);
    if (!skillMap.has(key)) skillMap.set(key,{text:skill.replace(/_/g,' '), source_fact_ids:[]});
    skillMap.get(key).source_fact_ids.push(fact.id);
  }
  return {index, facts, skills:[...skillMap.values()].sort((a,b) => Number(vacancy.includes(normalize(b.text)))-Number(vacancy.includes(normalize(a.text))))};
}

export function cvWriterSchema(profile) {
  const facts = [...factIndex(profile).values()];
  if (!facts.length) throw new Error('CV requires verified candidate facts');
  const ids = facts.map(f => f.id);
  const claim = obj({text:{type:'string', minLength:1, maxLength:550}, source_fact_ids:{type:'array', minItems:1, maxItems:6, uniqueItems:true, items:{enum:ids}}});
  const skillNames = [...new Set(facts.flatMap(f => f.skills ?? []).map(s => skillText(s).replace(/_/g,' ')))];
  const skill = structuredClone(claim);
  skill.properties.text = skillNames.length ? {enum:skillNames} : {type:'string', maxLength:0};
  const skillSchema=skillNames.length ? {oneOf:skillNames.map(text=>{
    const supportedIds=facts.filter(f=>(f.skills??[]).some(s=>skillText(s).replace(/_/g,' ')===text)).map(f=>f.id);
    return obj({text:{const:text},source_fact_ids:{type:'array',minItems:1,maxItems:Math.min(6,supportedIds.length),uniqueItems:true,items:{enum:supportedIds}}});
  })} : skill;
  const sectionIds = facts.filter(f => f.provenance && !['EDUCATION','COURSE'].includes(f.provenance)).map(f => f.id);
  const sectionSchema=sectionIds.length ? {oneOf:sectionIds.map(id=>{
    const bullet=structuredClone(claim);
    bullet.properties.source_fact_ids={type:'array',minItems:1,maxItems:1,items:{const:id}};
    return obj({source_fact_id:{const:id},bullets:{...array(bullet,3),minItems:1}});
  })} : obj({source_fact_id:str,bullets:{...array(claim,3),minItems:1}});
  return obj({headline:claim, summary:{...array(claim,2),minItems:1}, skills:{...array(skillSchema,14), ...(skillNames.length ? {minItems:1} : {maxItems:0})},
    sections:{...array(sectionSchema,4), ...(sectionIds.length ? {minItems:1} : {maxItems:0})},
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
    if (claim.kind === 'skill' && !cited.some(f => (f.skills ?? []).some(s => normalize(skillText(s)) === text))) error('UNSUPPORTED_SKILL_LABEL');
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

export function renderCvV2Html(document, profile, language, identity) {
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
  const education=(profile.education??[]).map(f=>`<article><h3>${escape(f.institution)}</h3><p>${escape([f.field,f.specialization].filter(known).join(' · '))}</p><p>${escape(f.status==='degree_in_progress' ? (pl?'Studia w toku':'Degree in progress') : f.status)}</p></article>`).join('');
  const training=(profile.training??[]).map(f=>`<p>${escape(f.title)}${known(f.provider)?` · ${escape(f.provider)}`:''}${f.certificate?` · ${pl?'certyfikat kursu':'course certificate'}`:''}</p>`).join('');
  const contacts=[identity.email,identity.phone,profile.onboarding?.github_url,profile.onboarding?.portfolio_url].filter(known);
  const location=[profile.candidate?.base_location?.city,profile.candidate?.base_location?.country].filter(known).join(', ');
  return `<!doctype html><html lang="${pl?'pl':'en'}"><meta charset="utf-8"><style>${CV_STYLE}</style><body>${identity.name?`<h1>${escape(identity.name)}</h1>`:''}<p class="headline">${escape(document.headline.text)}</p>${contacts.length?`<p class="contacts">${contacts.map(escape).join(' · ')}</p>`:''}${location?`<p class="meta">${escape(location)}</p>`:''}<h2>${labels.summary}</h2>${document.summary.map(c=>`<p>${escape(c.text)}</p>`).join('')}<h2>${labels.skills}</h2><p>${document.skills.map(c=>escape(c.text)).join(' · ')}</p>${prioritizedSections}${education?`<h2>${labels.education}</h2>${education}`:''}${training?`<h2>${labels.training}</h2>${training}`:''}<h2>${labels.languages}</h2><p>${(profile.languages??[]).map(l=>`${escape(l.language)} — ${escape(l.level)}`).join(' · ')}</p></body></html>`;
}
const CV_STYLE = readFileSync(new URL('./templates/cv-v2.css',import.meta.url),'utf8');

async function renderPdf(html, target) {
  const browser=await chromium.launch({headless:true});
  try {const page=await browser.newPage(); await page.setContent(html,{waitUntil:'load'}); await page.emulateMedia({media:'print'});
    const visual=await page.evaluate(()=>({no_horizontal_overflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth,
      headings_visible:[...document.querySelectorAll('h1,h2,h3')].every(e=>e.getBoundingClientRect().width>0 && getComputedStyle(e).fontSize!=='0px')}));
    await page.pdf({path:target,format:'A4',printBackground:true});
    return visual;
  } finally {await browser.close();}
}

export async function buildTailoredCv({job,profile,analysis,llm=new OllamaClient(),repository,outputRoot='data/cv-v2'}) {
  llm=resolveCvLlm(llm);
  if (job.availability_status!=='OPEN') throw new Error('Vacancy not verified OPEN');
  const catalog=selectCatalog(profile,analysis,job);
  const language=/^(pl|polish)$/i.test(job.language ?? job.metadata?.language ?? '') ? 'Polish' : 'English';
  const applicationRequested=Boolean(job.metadata?.cover_letter_required || job.metadata?.motivation_required || analysis?.application_text_requested);
  const identity=cvIdentityQa(profile);
  const rejected=analysis?.decision==='REJECT';
  const cvId=randomUUID();
  const dir=path.resolve(outputRoot,new Date().toISOString().slice(0,7),safeSlug(job.company),safeSlug(job.job_id),cvId);
  await mkdir(dir,{recursive:true});
  const manifest={cv_id:cvId,job_id:job.job_id,status:'BLOCKED_CLAIMS',profile_version:hash(JSON.stringify(profile)),template_version:CV_V2_VERSION,
    operation_run_id:operationContext.getStore()?.run_id??null,
    analysis_prompt_version:analysis?.prompt_version??null,
    source_decision:analysis?.decision ?? null,application_eligible:!rejected && ['AUTO_APPLY','REVIEW','STRETCH'].includes(analysis?.decision),
    language,model:llm.strongModel ?? llm.model ?? 'injected-gateway',verifier_model:llm.model ?? 'injected-gateway',created_at:new Date().toISOString(),
    pdf_path:null,html_path:null,document_path:null,source_map_path:path.join(dir,'source-fact-map.json'),manifest_path:path.join(dir,'manifest.json'),
    qa:{pass:false,claims:{pass:false},identity:{pass:identity.pass,status:identity.status,missing:identity.missing},pdf:{pass:false,status:'NOT_RENDERED'}}};
  let document;
  try {
    const schema=cvWriterSchema(profile);
    const validate=ajv.compile(schema);
    const writerStarted=performance.now();
    const writerSystem=await readFile(new URL('../../prompts/cv_writer_v2.md',import.meta.url),'utf8');manifest.writer_prompt_sha256=hash(writerSystem);
    if(repository?.pool)await observe(repository,{event:'CV_WRITER_STARTED',entity_type:'job',entity_id:job.job_id,message:'Grounded CV writer running',model:manifest.model});
    document=await llm.json({strong:true,numPredict:5000,schema,system:writerSystem,
      prompt:JSON.stringify({current_date:new Date().toISOString().slice(0,10),language,application_text_requested:applicationRequested,target:{title:job.title,description:job.description_text,role_family:analysis?.role_family},
        priority_fact_ids:analysis?.cv_focus_fact_ids ?? [],facts:catalog.facts.map(writerFact),allowed_skills:catalog.skills}),
      repairInstruction:'Use only supplied source IDs and supported facts. Keep provenance, qualifiers and degree status. No seniority or skills inferred from target title. Fix unsupported claims.',
      validate:value=>{if (!validate(value)) throw new StructuredOutputError('CV writer schema invalid');
        if (!applicationRequested && value.application_text.length) throw new StructuredOutputError('Unrequested application text');
        const qa=deterministicCvQa(value,profile); if (!qa.pass) throw new StructuredOutputError(`CV deterministic fact guards: ${qa.errors.map(e=>e.reason).join(', ')}`);}});
    if (!validate(document)) {document=undefined; throw new StructuredOutputError('CV writer schema invalid');}
    if (!applicationRequested && document.application_text.length) throw new StructuredOutputError('Unrequested application text');
    manifest.writer_stats=structuredClone(llm.lastStats??null);manifest.writer_duration_ms=Math.round(performance.now()-writerStarted);
    if(repository?.pool)await observe(repository,{event:'CV_WRITER_COMPLETED',entity_type:'job',entity_id:job.job_id,message:'CV writer completed; checking independent entailment',model:manifest.model,model_requests:llm.lastStats?.semantic_attempts});
    const deterministic=deterministicCvQa(document,profile);
    const verifierStarted=performance.now();
    if(repository?.pool)await observe(repository,{event:'CV_VERIFIER_STARTED',entity_type:'job',entity_id:job.job_id,message:'Independent CV entailment verifier running',model:manifest.verifier_model});
    const semantic=await verifyCvEntailment(document,profile,llm);
    manifest.verifier_stats=structuredClone(llm.lastStats??null);manifest.verifier_duration_ms=Math.round(performance.now()-verifierStarted);
    if(repository?.pool)await observe(repository,{event:'CV_VERIFIER_COMPLETED',entity_type:'job',entity_id:job.job_id,message:semantic.pass?'Every CV claim supported':'CV claims blocked by independent verifier',claims_pass:semantic.pass,model:manifest.verifier_model,model_requests:llm.lastStats?.semantic_attempts});
    manifest.qa.claims={pass:deterministic.pass && semantic.pass,deterministic,semantic};
    manifest.document_path=path.join(dir,'cv.json');
    manifest.html_path=path.join(dir,'cv.html');
    const html=renderCvV2Html(document,profile,language,identity.identity);
    await writeFile(manifest.document_path,JSON.stringify({...document,target_job_id:job.job_id,language,identity:identity.identity},null,2));
    await writeFile(manifest.html_path,html);
    manifest.status=!manifest.qa.claims.pass ? 'BLOCKED_CLAIMS' : !identity.pass ? 'BLOCKED_IDENTITY' : 'BLOCKED_PDF';
    if (manifest.qa.claims.pass && identity.pass && !rejected) {
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
      manifest.qa.pdf=pdfQa;
      manifest.pdf_path=pdfPath; manifest.sha256=hash(buffer);
      manifest.status=pdfQa.pass ? 'PASS' : 'BLOCKED_PDF';
    }
  } catch (error) {manifest.qa.error={code:error.name,message:error.message};}
  if (rejected) {manifest.content_status=manifest.status;manifest.status='REJECTED_DIAGNOSTIC_CONTENT';manifest.application_eligible=false;}
  manifest.qa.pass=manifest.status==='PASS';
  await writeFile(manifest.source_map_path,JSON.stringify({profile_version:manifest.profile_version,claims:document?cvClaimCatalog(document):[],
    deterministic_sections:{education:(profile.education??[]).map(f=>f.id),training:(profile.training??[]).map(f=>f.id),languages:(profile.languages??[]).map(f=>f.id),
      metadata:document?document.sections.map(s=>({source_fact_id:s.source_fact_id,fields:['role','title','employer','organization','environment','provenance','start_date','exact_start_date','exact_end_date','status']})):[]},facts:catalog.facts},null,2));
  await writeFile(manifest.manifest_path,JSON.stringify(manifest,null,2));
  if (repository?.recordCvDraft) await repository.recordCvDraft(manifest);
  return manifest;
}
