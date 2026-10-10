import {readFile} from 'node:fs/promises';
import Ajv from 'ajv';
import {OllamaClient, StructuredOutputError} from './llm.mjs';
import {createHash} from 'node:crypto';
import {explicitWorkMode} from './work-format-evidence.mjs';

export const PROMPT_VERSION = 'fit-analysis-v3.3-qualified-clause-boundaries';
const provenance = ['PROFESSIONAL','INDEPENDENT_R_AND_D','ACADEMIC','PERSONAL_PROJECT','COURSE','EDUCATION'];
const categories = ['TECHNICAL','PROFESSIONAL_EXPERIENCE','EDUCATION','LANGUAGE','LEGAL','LOCATION','OTHER'];
const importanceWeights = {MANDATORY: 0.7, STRONG_PREFERENCE: 0.2, NICE_TO_HAVE: 0.1, DESCRIPTION_ONLY: 0};
const defaultWeights = {TECHNICAL: 40, PROFESSIONAL_EXPERIENCE: 30, EDUCATION: 20, LANGUAGE: 10, OTHER: 5};
const string = {type: 'string'};
const strings = {type: 'array', uniqueItems: true, items: string};
const nullableBoolean = {type: ['boolean','null']};
const nullableNumber = {type: ['number','null'], minimum: 0};
const nullableString = {type: ['string','null']};
const object = properties => ({type: 'object', additionalProperties: false, properties, required: Object.keys(properties)});
const qualificationBlocker = req => req.strict && req.importance === 'MANDATORY'
  && req.match === 'NO' && req.category !== 'LOCATION';
const authorizationCondition = /\b(?:work\s+(?:authorization|permit)|right\s+to\s+work|citizen(?:ship)?|visa|immigration|sponsorship|security\s+clearance|export\s+control)\b/i;
const hiringCondition = /\b(?:hire|hiring|employ|employment|contract|contractor|b2b|eor|employer of record)\b/i;
const explicitPolishRemoteEmployment = /\b(?:remotely|remote)\s+from\s+Poland\b.*\bPolish\s+employment\s+contract\b/i;
const missingString = value => /^(?:unknown|unspecified|not specified|n\/?a|none|null|undefined|\?)$/i.test(String(value??'').trim()) ? null : value;
export function normalizeWorkFormatUnknowns(format={}) {
  return Object.fromEntries(Object.entries(format).map(([key,value])=>[key,typeof value==='string'&&key!=='employment_route'?missingString(value):value]));
}
export function explicitHybridQuote(job) {
  return String(job.description_text??'').split(/\n|(?<=[.!?])\s+/).find(text=>
    /^(?:note\s*:\s*)?(?:this|the)\s+(?:(?:role|position|job|internship)\s+(?:is|will be|requires)|will be)\b[^.!?]*\bhybrid\b/i.test(text)
    || /^hybrid (?:role|position|work|working|arrangement)\b/i.test(text));
}
export function groundedWorkNumbers(job,profile={}) {
  const numbers={onsite_days_per_week:null,onsite_days_per_month:null,office_distance_km:null};
  const words={zero:0,no:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7};
  for(const text of String(job.description_text??'').split(/\n|(?<=[.!?])\s+/)){
    if(/on[- ]?site|in[- ]?office|office attendance|at the office|commut|hybrid|travel/i.test(text)){
      for(const match of text.matchAll(/\b(\d+|zero|no|one|two|three|four|five|six|seven)\s+(?:(?:on[- ]?site|office)\s+)?days?\s*(?:(?:per|a|each|\/)\s*(week|month)|(weekly|monthly))/gi)){
        const amount=/^\d+$/.test(match[1])?Number(match[1]):words[match[1].toLowerCase()];
        numbers[/week/i.test(match[2]??match[3])?'onsite_days_per_week':'onsite_days_per_month']=amount;
      }
    }
    const base=normalize(profile.candidate?.base_location?.city??'Wroclaw');
    const distance=normalize(text).match(/\b(\d+(?:\.\d+)?)\s*km\s+from\s+([\p{L} ]+)/u);
    if(distance&&normalize(distance[2]).startsWith(base))numbers.office_distance_km=Number(distance[1]);
  }
  return numbers;
}
const polishHiringEvidence = /\bPolish\s+employment\s+contract\b|\b(?:hire|hiring|employ|employment|contractor|b2b|eor)\b[^.!?;]*\b(?:Poland|worldwide|globally)\b|\bPoland\b[^.!?;]*\b(?:hire|employ|employment|contractor|b2b|eor)\b/i;

export const FIT_SCHEMA = object({
  role_family: string, role_level: string,
  hard_blockers: {type: 'array', items: object({requirement_index: {type: 'integer', minimum: 0}, reason: string})},
  requirements: {type: 'array', maxItems: 1000, items: object({
    requirement: string, source_quote: string,
    importance: {enum: Object.keys(importanceWeights)}, category: {enum: categories},
    candidate_evidence_fact_ids: strings,
    candidate_evidence_provenance: {type: 'array', items: {enum: [...provenance, null]}},
    match: {enum: ['YES','PARTIAL','NO','UNKNOWN']}, reason: string,
    genuinely_ambiguous: {type: 'boolean'}, min_years: nullableNumber,
    professional_only: {type: 'boolean'}, skill: nullableString,
    strict: {type: 'boolean'}
  })},
  matched_fact_ids: strings, gaps: strings, cv_focus_fact_ids: strings,
  keywords_supported_by_profile: strings, keywords_not_supported_by_profile: strings,
  career_alignment: {enum: ['HIGH','MEDIUM','LOW']}, reasoning_summary: string,
  work_format: object({
    remote_allowed: nullableBoolean, remote_region: nullableString,
    employee_residency_requirement: nullableString,
    office_location: nullableString, office_country: nullableString,
    office_distance_km: nullableNumber, hybrid_required: nullableBoolean,
    onsite_days_per_week: nullableNumber, onsite_days_per_month: nullableNumber,
    onsite_frequency_text: nullableString, business_travel_required: nullableBoolean,
    relocation_required: nullableBoolean, work_from_poland_allowed: nullableBoolean,
    can_hire_in_poland: nullableBoolean,
    employment_route: {enum: ['PL_EMPLOYEE','EOR','B2B','CONTRACTOR','RELOCATION','SPONSORSHIP','UNKNOWN']},
    work_authorization_required: nullableString, authorization_known_impossible: {type: 'boolean'},
    sponsorship_available: nullableBoolean, security_clearance_requirement: nullableString,
    export_control_requirement: nullableString, evidence: strings
  })
});
const validateSchema = new Ajv({strict: true, allErrors: true}).compile(FIT_SCHEMA);

const compactWorkProperties = structuredClone(FIT_SCHEMA.properties.work_format.properties);
delete compactWorkProperties.evidence;
compactWorkProperties.evidence_fragment_ids = {type: 'array', maxItems: 8, uniqueItems: true,
  items: {type: 'integer', minimum: 0}};
export const COMPACT_FIT_SCHEMA = object({
  role_family: string, role_level: string, career_alignment: {enum: ['HIGH','MEDIUM','LOW']},
  requirements: {type: 'array', maxItems: 100, items: object({
    source_fragment_id: {type: 'integer', minimum: 0},
    importance: {enum: Object.keys(importanceWeights)}, category: {enum: categories},
    candidate_evidence_fact_ids: {type: 'array', maxItems: 4, uniqueItems: true, items: string},
    match: {enum: ['YES','PARTIAL','NO','UNKNOWN']}, reason: {type: 'string', maxLength: 160},
    skill: nullableString, strict: {type: 'boolean'}
  })}, work_format: object(compactWorkProperties)
});
const explicitRequirementSchema = structuredClone(COMPACT_FIT_SCHEMA.properties.requirements.items);
delete explicitRequirementSchema.properties.source_fragment_id;
explicitRequirementSchema.required = explicitRequirementSchema.required.filter(key => key !== 'source_fragment_id');
// The production grammar requires each explicit source ID as an object key.
// Legacy explicitly injected unit gateways may still supply the flat array.
COMPACT_FIT_SCHEMA.properties.explicit_requirements = {type: 'object', maxProperties: 100,
  propertyNames: {pattern: '^(0|[1-9][0-9]*)$'}, additionalProperties: explicitRequirementSchema};
const validateCompactSchema = new Ajv({strict: true, allErrors: true}).compile(COMPACT_FIT_SCHEMA);

export function compactSchemaForJob(job, profile, catalog = sourceFragmentCatalog(job)) {
  const schema = structuredClone(COMPACT_FIT_SCHEMA);
  const ids = [...factIndex(profile).keys()];
  const requirementIds = catalog.filter(f => !f.list_container && !f.work_format_only && !f.context_only).map(f => f.id);
  const explicitIds = catalog.filter(f => f.importance_hint && !f.list_container && !f.work_format_only).map(f => f.id);
  const additionalIds = requirementIds.filter(id => !explicitIds.includes(id));
  const totalLimit = Math.min(100, requirementIds.length || 100, Math.max(20, explicitIds.length + 10));
  schema.properties.requirements.maxItems = Math.max(0, totalLimit - explicitIds.length);
  schema.properties.requirements.items.properties.source_fragment_id = additionalIds.length ? {enum: additionalIds} : {type: 'integer', minimum: 0};
  if (!additionalIds.length) schema.properties.requirements.maxItems = 0;
  schema.properties.requirements.items.properties.candidate_evidence_fact_ids.items = ids.length ? {enum: ids} : {type: 'string', maxLength: 0};
  const keyedItem = structuredClone(schema.properties.requirements.items);
  delete keyedItem.properties.source_fragment_id;
  keyedItem.required = keyedItem.required.filter(key => key !== 'source_fragment_id');
  schema.$defs = {explicit_requirement: keyedItem};
  schema.properties.requirements = {type: 'object', additionalProperties: false,
    maxProperties: schema.properties.requirements.maxItems,
    properties: Object.fromEntries(additionalIds.map(id => [String(id), {$ref: '#/$defs/explicit_requirement'}]))};
  schema.properties.explicit_requirements = {type: 'object', additionalProperties: false,
    required: explicitIds.map(String), properties: Object.fromEntries(explicitIds.map(id => [String(id), {$ref: '#/$defs/explicit_requirement'}]))};
  for(const field of ['requirements','explicit_requirements'])for(const fragment of catalog){
    if(!fragment.category_hint||!schema.properties[field].properties[String(fragment.id)])continue;
    const item=structuredClone(keyedItem);item.properties.category={const:fragment.category_hint};
    schema.properties[field].properties[String(fragment.id)]=item;
  }
  // Decode the mandatory/preferred map first. Optional source keys are merely
  // permitted references, not a second list of requirements to manufacture.
  schema.properties = {role_family:schema.properties.role_family, role_level:schema.properties.role_level,
    career_alignment:schema.properties.career_alignment,
    explicit_requirements:schema.properties.explicit_requirements, requirements:schema.properties.requirements,
    work_format:schema.properties.work_format};
  schema.required.push('explicit_requirements');
  if(explicitHybridQuote(job))schema.properties.work_format.properties.hybrid_required={const:true};
  for(const [field,value] of Object.entries(groundedWorkNumbers(job,profile)))schema.properties.work_format.properties[field]={const:value};
  schema.properties.work_format.properties.evidence_fragment_ids.items = catalog.length ? {enum: catalog.map(f => f.id)} : {type: 'integer', minimum: 0};
  if (!authorizationCondition.test(job.description_text || ''))
    schema.properties.work_format.properties.authorization_known_impossible = {enum: [false]};
  if (!hiringCondition.test(job.description_text || '')) {
    schema.properties.work_format.properties.can_hire_in_poland = {enum: [null, false]};
    schema.properties.work_format.properties.employment_route = {enum: ['UNKNOWN', 'RELOCATION']};
  }
  if (!polishHiringEvidence.test(job.description_text || ''))
    schema.properties.work_format.properties.can_hire_in_poland = {const:null};
  if (catalog.some(fragment => explicitPolishRemoteEmployment.test(fragment.text))) {
    for (const [field, value] of Object.entries({remote_allowed:true, remote_region:'Poland',
      work_from_poland_allowed:true, can_hire_in_poland:true, employment_route:'PL_EMPLOYEE'}))
      schema.properties.work_format.properties[field] = {const: value};
  }
  return schema;
}

/** IDs refer to original contiguous text, avoiding generated quotations entirely. */
function workFormatStatement(text) {
  text=String(text).trim().replace(/^[-*•]\s+/,'');
  if(/^(?:work (?:format|mode)|tryb pracy|model pracy)\s*:/i.test(text))return true;
  if(/^remote[- ]first\b.*\b(?:no|without)\b.*\b(?:required\s+)?commute\b/i.test(text))return true;
  // Employer capabilities and descriptions of the offered arrangement do not
  // assert a qualification possessed by the candidate. Explicit candidate
  // legal/location conditions remain available for requirement mapping.
  if (/\b(?:must|required|requirement|essential|willingness|authorization|authorized|permit|visa|clearance|citizen(?:ship)?|residen(?:t|cy))\b/i.test(text)) return false;
  return /^(?:the (?:employer|company)|we)\b.*\b(?:can|will|are able to)\s+(?:hire|employ)\b/i.test(text)
    || /^note\s*:.*\b(?:remote|hybrid|on[- ]?site)\b/i.test(text)
    || /^work(?:ing)?\b.*\bremot(?:e|ely)\b/i.test(text)
    || /^(?:(?:this|the)\s+)?(?:role|position|job)\b.*\b(?:remote|hybrid|on[- ]?site)\b/i.test(text)
    || /^(?:remote|hybrid|on[- ]?site)(?:[\s:.,-]|$)/i.test(text)
    || /^(?:polish|eu|permanent|full[- ]time|part[- ]time|b2b|contractor)\s+(?:employment\s+)?contract\b/i.test(text);
}

function employerContextStatement(text) {
  if(/^(?:oferujemy\s|organizacja pracy\s|nasze wymagania (?:jakosciowe|produkcyjne|techniczne) dotycza (?:oferowanych )?(?:produktow|uslug|procesow))/.test(normalize(text)))return true;
  if (/^to be in consideration for multiple roles\b|^please apply to (?:each|the top)\b|^we will accept resumes on a rolling basis\b/i.test(text)) return true;
  if (/\bnot (?:required|mandatory|essential)\b/i.test(text)) return true;
  if (/\b(?:candidates?|you|must|required|require|expect|seek|qualification)\b/i.test(text)) return false;
  return /^(?:we|our (?:company|team|process|mission))\b/i.test(text)
    || /\b(?:projects?|experience)\b.*\b(?:valid (?:hands-on )?evidence|projects count|not required)\b/i.test(text)
    || /^(?:full[- ]time|part[- ]time)[.!]?$/i.test(text);
}
export function sourceCategoryHint(text) {
  const value=normalize(text);
  if(/^ausbildung\s*:|^formation\s*\/(?:\s*experience)?|^(?:voraussetzung.*immatrikulation)/.test(value))return 'EDUCATION';
  if(/^sprachen\s*:|^(?:english|german|french|polish|deutsch|englisch)\s+(?:[abc][12]|language|fluency)/.test(value))return 'LANGUAGE';
  if(/^arbeitsalltag\s*:/.test(value))return 'LOCATION';
  if(/^erfahrungen und know-?how\s*:/.test(value))return 'TECHNICAL';
  if(/^personlichkeit und arbeitsweise\s*:|^begeisterung\s*:/.test(value))return 'OTHER';
  return null;
}

function standaloneQualificationHeading(text) {
  // Bounded section names only. Matching "qualifications" or "skills" inside
  // employer prose would manufacture candidate obligations. Keep source text
  // untouched: normalization here is solely for detecting the heading.
  const key = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/ł/g,'l').replace(/[:—.-]+\s*$/, '').trim();
  if(/^(?:czego oczekujemy\??|oczekujemy|nasze wymagania|wymagania(?: wobec kandydata)?|wymagamy|oczekiwania|kogo szukamy\??|twoj profil|kwalifikacje)$/.test(key))
    return {importance:'MANDATORY'};
  if(/^(?:mile widziane|dodatkowe atuty|preferowane kwalifikacje)$/.test(key))
    return {importance:'STRONG_PREFERENCE'};
  if(/^(?:na tym stanowisku bedziesz|twoje obowiazki|glowne obowiazki|zakres obowiazkow|obowiazki|organizacja pracy|co oferujemy\??|oferujemy|to oferujemy|nasza oferta|benefity|warunki zatrudnienia)$/.test(key))
    return {importance:null};
  if (/^(?:must have|essential skills|minimum requirements|you have|who you are|what you bring|about you|your qualifications|qualifications|required qualifications|(?:required|minimum|basic) skills(?: and experience)?|formation\s*(?:\/|et)\s*experience|competences(?: techniques)?|qualites personnelles|profil recherche|votre profil)$/.test(key))
    return { importance: 'MANDATORY' };
  if (/^(?:we prefer|desired skills(?: and experience)?|competences souhaitees|qualifications souhaitees|atouts|nous preferons)$/.test(key))
    return { importance: 'STRONG_PREFERENCE' };
  if(/^(?:nice to have|nice-to-have|bonus skills)$/.test(key))return{importance:'NICE_TO_HAVE'};
  if (/^(?:qualifikationen|ihr profil|dein profil|was sie mitbringen|was du mitbringst|anforderungen)$/.test(key))
    return { importance: 'MANDATORY' };
  if (/^(?:wunschqualifikationen|wunschprofil|von vorteil|wunschenswert)$/.test(key))
    return { importance: 'STRONG_PREFERENCE' };
  if (/^(?:unternehmensbeschreibung|stellenbeschreibung|zusatzliche informationen|weitere informationen|ihre aufgaben|deine aufgaben|was wir bieten|unser angebot|benefits|videos to watch)$/.test(key))
    return { importance: null };
  // Bosch uses inline headings followed by the exact qualification. The label
  // itself is not a separate scored fragment; the original whole clause stays.
  if (/^(?:ausbildung|erfahrungen und know-?how|personlichkeit und arbeitsweise|begeisterung|sprachen|arbeitsalltag)\s*:\s*\S/.test(key))
    return { importance: 'MANDATORY', headingOnly: false };
  if (/^(?:ausbildung|erfahrungen und know-?how|personlichkeit und arbeitsweise|begeisterung|sprachen|arbeitsalltag)$/.test(key))
    return { importance: 'MANDATORY' };
  if (/^(?:job description|you will|what you['’]ll do|what you will do|what we offer|how to apply|what to expect|important information|who we are|about [\p{L}\p{N}& -]+|role description|key responsibilities|responsibilities|recruitment process|additional information|pay disclosure|poland employee benefits|estimated hourly pay range|missions principales|vos missions|description (?:de l'entreprise|de la societe|du poste)|informations supplementaires|avantages|et maintenant\s*\?|processus de recrutement|what is [\p{L}\p{N} -]+\?)$/u.test(key))
    return { importance: null };
  // A trailing note starts application/work-arrangement context, but an explicit
  // qualification in the note (e.g. clearance required) is still evaluated.
  if (/^note\s*:\s*\S/.test(key)) return { importance: null, headingOnly: false };
  return null;
}

function knownSourceOfficeCountry(job={}) {
  const names=[...new Set([...Object.values(countryCodes),'new zealand','australia','canada'])];
  const raw=countryName(job.country);if(names.includes(raw))return raw;
  const location=normalize(job.location);
  if(/(?:,\s*|^)nz$/.test(location))return 'new zealand';
  if(/(?:,\s*|^)uk$/.test(location))return 'united kingdom';
  for(const name of names.sort((a,b)=>b.length-a.length))
    if(new RegExp(`\\b${name}\\b`,'i').test(location))return name;
  return null;
}
function qualificationSentences(source,{job}={}) {
  let scope = null;let contextScope=false;let conditionalRegion=null;const officeCountry=knownSourceOfficeCountry(job);
  // Avoid splitting an example qualifier after e.g./z.B. The original text and
  // exact-source quotation remain unchanged; only the boundary decision changes.
  const pieces=[];let start=0;
  for(const match of source.matchAll(/(?<=[.!?;])\s+|\n+/g)){
    if(!match[0].includes('\n')&&/(?:\be\.g\.|\bi\.e\.|\bz\.\s*b\.|\bu\.s\.|\betc\.)$/i.test(source.slice(start,match.index)))continue;
    // Polish licence abbreviations are part of the same exact qualification.
    if(!match[0].includes('\n')&&/(?:\bgr\.|\bkat\.)$/i.test(source.slice(start,match.index))
      && /^(?:\d|[A-Z]\b)/.test(source.slice(match.index+match[0].length)))continue;
    pieces.push(source.slice(start,match.index));start=match.index+match[0].length;
  }pieces.push(source.slice(start));
  return pieces.map(text => text.trim()).filter(Boolean).map(text => {
    const officeHeading=text.match(/^for candidates seeking to work in (.+?) offices only\s*:?$/i);
    if(officeHeading){conditionalRegion=countryName(officeHeading[1]);scope=null;contextScope=true;return{text,importance:null,list:null,headingOnly:true,contextOnly:true,conditional_region:conditionalRegion};}
    const standalone = standaloneQualificationHeading(text);
    const headings = [...text.matchAll(/\b(what you must have|minimum qualifications|required qualifications|basic qualifications|(?:candidate|job|role) requirements|what we are looking for(?: in you)?|what you(?:['’]ll| will) be doing|get some bonus points|preferred qualifications|additional skills that you might also bring|what we offer you|benefits|interview process|equal employment)\b|^requirements\s*:?$/gi)];
    if (standalone) {scope = standalone.importance;contextScope=standalone.importance===null;conditionalRegion=null;}
    else if (headings.length) {
      const heading = headings.at(-1)[0];
      scope = /must have|minimum|required|basic|requirements/i.test(heading) ? 'MANDATORY'
        : /bonus|preferred|looking for/i.test(heading) ? 'STRONG_PREFERENCE'
        : /additional skills/i.test(heading) ? 'NICE_TO_HAVE' : null;
      contextScope=scope===null;
    }
    const headingOnly = standalone ? standalone.headingOnly !== false : headings.some(heading => text.replace(/[:—-]\s*$/, '').trim().toLowerCase() === heading[0].replace(/:\s*$/, '').trim().toLowerCase());
    const untrustedCommand = /ignore (?:previous|system|all) instructions|(?:reveal|expose|print|send|upload).*(?:secrets?|tokens?|environment variables)|upload another|localhost/i.test(text);
    const nonQualification = /\b(?:regional|regulatory) requirements\b|\brequirements? vector\b|\b(?:when|whether|what|which|if)\b.*\bdata\b.*\brequired\b|\bdata required for (?:analys[ei]s|reports?|processing)\b|\bnot (?:required|mandatory|essential)\b|\bproducing required documentation\b/i.test(text);
    const list = text.match(/\b(mandatory|required|nice to have|preferred)\s*:\s*(.*)/i);
    let importance = null;
    if (!headingOnly && !untrustedCommand && !nonQualification && !workFormatStatement(text) && !employerContextStatement(text)) {
      importance = list ? /mandatory|required/i.test(list[1]) ? 'MANDATORY' : /nice/i.test(list[1]) ? 'NICE_TO_HAVE' : 'STRONG_PREFERENCE'
        : /\b(required|mandatory|must have|must possess|essential|is a must|erforderlich|voraussetzung|zwingend|notwendig)\b|wymagan|obowiazkow/i.test(text) ? 'MANDATORY'
        : /\b(nice to have|helpful)\b/i.test(text) ? 'NICE_TO_HAVE'
        : /\b(?:preferred|wunschenswert|wünschenswert|(?:a |an )?(?:strong |clear |distinct )?(?:advantage|asset))\b|von vorteil/i.test(text) && !/your preferred mode/i.test(text) ? 'STRONG_PREFERENCE' : scope;
    }
    if(conditionalRegion&&/\b(?:applicants?|candidates?|employees?|you)\b.*\b(?:must be|eligible|authorizations?|citizenship|nationality)\b/i.test(text))importance='MANDATORY';
    if(conditionalRegion&&officeCountry&&conditionalRegion!==officeCountry)importance=null;
    return {text, importance, list, headingOnly,contextOnly:conditionalRegion&&officeCountry&&conditionalRegion!==officeCountry||contextScope&&!importance,
      category_hint:sourceCategoryHint(text),...(conditionalRegion?{conditional_region:conditionalRegion}:{})};
  });
}

function requirementItems(text, list) {
  // Commas inside examples and conjunctions inside a qualified ability are
  // part of one claim, not independently required qualifications.
  if(/[()]/.test(text)||/^(?:[•*-]\s*)?(?:ability|accuracy|good communication|analytical|field of study|education|basic (?:knowledge|understanding)|fundamental understanding)\b/i.test(text))return [];
  // Alternative fields and examples qualify the one requirement; they are not
  // independent qualifications which the candidate must satisfy simultaneously.
  if (/\b(?:or|either|such as|for example|including|eg|ou|soit|notamment|par exemple|oder|beispielsweise)\b|\be\.g\.|\bz\.\s*b\./i.test(text)) return [];
  // Licence group numbers and a preferred specialization qualify one clause;
  // neither is a list of independent candidate obligations.
  if(/\d\s*,\s*\d|\b(?:lub|albo|preferowan[aey]|preferowane|preferowany|np)\b/i.test(normalize(text)))return [];
  const content = (list?.[2] || text).replace(/[.!?;]+$/, '');
  return content.split(/,|\s+and\s+/i).map(item => item.trim()).filter(Boolean);
}

export function sourceFragmentCatalog(job) {
  const sources = [{text: job.title, context_only: true}, {text: job.description_text},
    {text: job.location, work_format_only: true}, {text: job.country, work_format_only: true},
    {text: job.work_mode, work_format_only: true}].filter(source => source.text);
  const catalog = []; const seen = new Map();
  const add = (text, importance_hint = null, list_container = false, metadataOnly = false, contextOnly = false,categoryHint=null,conditionalRegion=null) => {
    text = text.trim();
    if (!text || /^(?:(?:\d+|[A-Za-z])[.)]|DU(?:…|\.\.\.))$/i.test(text)) return;
    if(/^[*✅\s]*(?:(?:minimum\s+)?required|mandatory|(?:other|license\/certification|core competencies|clearance|key skills|skills|technical skills|experience|system specs|tools proficiency|critical skills) required|the following(?: qualifications)? are required|what skills\/qualities are required)\s*:\s*$/i.test(text)){importance_hint=null;contextOnly=true;}
    if (seen.has(text)) {
      const entry = catalog[seen.get(text)];
      if (importance_hint) entry.importance_hint = importance_hint;
      if (metadataOnly && !entry.importance_hint) entry.work_format_only = true;
      if (contextOnly && !entry.importance_hint) entry.context_only = true;
      if(categoryHint)entry.category_hint=categoryHint;
      if(conditionalRegion)entry.conditional_region=conditionalRegion;
      return;
    }
    const entry = {id: catalog.length, text, importance_hint, list_container,
      work_format_only: metadataOnly || workFormatStatement(text),
      context_only: !importance_hint && Boolean(contextOnly || employerContextStatement(text)),...(categoryHint?{category_hint:categoryHint}:{}),...(conditionalRegion?{conditional_region:conditionalRegion}:{})};
    if(entry.work_format_only)entry.importance_hint=null;
    seen.set(text, entry.id); catalog.push(entry);
  };
  for (const {text: sentence, importance: hint, list, metadataOnly, contextOnly,category_hint,conditional_region} of sources.flatMap(source =>
    qualificationSentences(source.text,{job}).map(sentence => ({...sentence, metadataOnly: source.work_format_only, contextOnly: source.context_only || sentence.headingOnly||sentence.contextOnly})))) {
    const compound = hint && !list && /,|\s+and\s+/i.test(sentence);
    const items = list || compound ? requirementItems(sentence, list) : [];
    add(sentence, hint, items.length > 0, metadataOnly, contextOnly,category_hint,conditional_region);
    for (const item of items) add(item, hint,false, metadataOnly, contextOnly,category_hint,conditional_region);
  }
  return catalog;
}

export function expandCompactAnalysis(wire, {job, profile, catalog = sourceFragmentCatalog(job)}) {
  const decode = map => {
    if (!map || typeof map !== 'object' || Array.isArray(map)) throw new StructuredOutputError('Compact source mapping must be an object');
    return Object.entries(map).map(([id, req]) => {
      if (!/^(0|[1-9][0-9]*)$/.test(id) || Object.hasOwn(req || {}, 'source_fragment_id'))
        throw new StructuredOutputError('Compact source mapping must use exact integer IDs as keys');
      return {...req, source_fragment_id: Number(id)};
    });
  };
  const additional = Array.isArray(wire.requirements) ? wire.requirements : decode(wire.requirements);
  if (!validateCompactSchema({...wire, requirements: additional})) throw new StructuredOutputError('Compact fit JSON schema mismatch');
  const facts = factIndex(profile);
  const fragment = id => {
    const value = catalog[id];
    if (!value || value.id !== id) throw new StructuredOutputError('Unknown source fragment ID');
    return value;
  };
  const mappedRequirements = [...decode(wire.explicit_requirements || {}), ...additional];
  const requirements = mappedRequirements.map(req => {
    const source = fragment(req.source_fragment_id);
    if (source.list_container) throw new StructuredOutputError('Mandatory or preferred list must map each item separately');
    if (source.work_format_only) throw new StructuredOutputError('Work-format statement is employer evidence, not a candidate qualification');
    if (source.context_only) throw new StructuredOutputError('Employer or role context is not a candidate qualification');
    if(source.category_hint&&req.category!==source.category_hint)
      throw new StructuredOutputError(`Source qualification category must be ${source.category_hint}: ${source.text}`);
    const factIds = req.candidate_evidence_fact_ids;
    for (const id of factIds) if (!facts.has(id)) throw new StructuredOutputError('Unknown candidate evidence ID');
    const years = source.text.match(/\b(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)\b/i)?.[1];
    const professionalOnly = Boolean(years && /\b(professional|commercial)\b/i.test(source.text));
    const explicitDomain = professionalOnly ? source.text.match(/\b(?:professional|commercial)\s+(.+?)\s+experience\b/i)?.[1] : null;
    return {requirement: source.text, source_quote: source.text,
      importance: source.importance_hint || req.importance,
      category: /\bwillingness\s+to\s+relocate\b/i.test(source.text) ? 'LOCATION' : req.category,
      candidate_evidence_fact_ids: factIds,
      candidate_evidence_provenance: [...new Set(factIds.map(id => facts.get(id).provenance).filter(Boolean))],
      match: req.match, reason: req.reason, genuinely_ambiguous: req.match === 'UNKNOWN' && factIds.length > 0,
      min_years: years ? Number(years) : null,
      professional_only: professionalOnly,
      skill: explicitDomain || req.skill, strict: req.strict};
  });
  const usedFragmentIds = mappedRequirements.map(req => req.source_fragment_id);
  if (new Set(usedFragmentIds).size !== usedFragmentIds.length) {
    const duplicate = usedFragmentIds.find((id, index) => usedFragmentIds.indexOf(id) !== index);
    throw new StructuredOutputError(`Duplicate requirement source fragment ${duplicate}: ${fragment(duplicate).text}. Use each source_fragment_id once; classify that entire clause in one row`);
  }
  const missingIds = catalog.filter(source => source.importance_hint
    && !source.list_container && !usedFragmentIds.includes(source.id));
  if (missingIds.length) throw new StructuredOutputError(`Explicit ${missingIds.some(source => source.importance_hint === 'MANDATORY') ? 'mandatory ' : ''}requirement omitted: source_fragment_id ${missingIds.map(source => source.id).join(', ')}`);
  const work_format = {...wire.work_format};
  work_format.evidence = wire.work_format.evidence_fragment_ids.map(id => fragment(id).text);
  delete work_format.evidence_fragment_ids;
  const positives = requirements.filter(req => ['YES','PARTIAL'].includes(req.match));
  const mappedIds = [...new Set(positives.flatMap(req => req.candidate_evidence_fact_ids))];
  const result = {role_family: wire.role_family, role_level: wire.role_level,
    career_alignment: wire.career_alignment, requirements, work_format,
    hard_blockers: requirements.flatMap((req, index) => qualificationBlocker(req)
      ? [{requirement_index: index, reason: req.reason}] : []),
    matched_fact_ids: mappedIds, cv_focus_fact_ids: mappedIds,
    gaps: requirements.filter(req => req.match !== 'YES').map(req => req.requirement),
    keywords_supported_by_profile: [...new Set(positives.map(req => req.skill).filter(Boolean))],
    keywords_not_supported_by_profile: [...new Set(requirements.filter(req => ['NO','UNKNOWN'].includes(req.match)).map(req => req.skill).filter(Boolean))],
    reasoning_summary: `${wire.role_family}; ${requirements.length} fact-mapped requirements.`};
  validateFactIntegrity(result, profile, job);
  return result;
}

export function factIndex(profile) {
  const facts = new Map();
  for (const key of ['facts','experience','projects','education','training','languages']) {
    for (const fact of profile[key] || []) {
      if (!fact.id || facts.has(fact.id)) throw new Error(`Missing or duplicate candidate fact ID in ${key}`);
      if (key !== 'languages' && !provenance.includes(fact.provenance)) throw new Error('Invalid candidate fact provenance');
      facts.set(fact.id, {...fact, provenance: fact.provenance ?? null});
    }
  }
  // Explicit profile skills are facts, but have no implied employment provenance.
  for (const [group, skills] of Object.entries(profile.skills || {})) {
    for (const [index, skill] of skills.entries()) {
      const id = `skill_${group}_${index}`;
      if (facts.has(id)) throw new Error('Duplicate skill fact ID');
      facts.set(id, {id, provenance: null, type: 'verified_skill', statements: [skill], skills: [skill]});
    }
  }
  const addMetadata=(id,statements)=>{if(facts.has(id))throw new Error('Duplicate candidate metadata fact ID');facts.set(id,{id,provenance:null,type:'verified_candidate_metadata',statements});};
  const known=value=>typeof value==='string'&&value.trim()&&!/^(?:unknown|null|n\/a)$/i.test(value.trim());
  const base=profile.candidate?.base_location;
  if(base&&[base.city,base.country].some(known))addMetadata('candidate_base_location',[`Declared base location: ${[base.city,base.country].filter(known).join(', ')}.`]);
  if(profile.candidate?.citizenship?.length&&profile.candidate.citizenship.every(known))addMetadata('candidate_citizenship',[`Declared citizenship: ${profile.candidate.citizenship.join(', ')}.`]);
  if(typeof profile.candidate?.eu_citizen==='boolean')addMetadata('candidate_eu_citizenship',[`Declared EU citizenship: ${profile.candidate.eu_citizen}. This does not establish an employer hiring route or a non-EU permit.`]);
  if(typeof profile.candidate?.availability?.full_time==='boolean')addMetadata('candidate_full_time_availability',[`Declared full-time availability: ${profile.candidate.availability.full_time}. No start date or notice period is inferred.`]);
  return facts;
}

const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[łŁ]/g,'l').replace(/_/g,' ').toLowerCase().trim();
const quoted = (text, source) => normalize(source).includes(normalize(text)) && Boolean(text?.trim());
const hasSkill = (fact, skill) => !skill || (fact.skills || []).some(s => normalize(s) === normalize(skill))
  || (fact.statements || []).some(s => quoted(skill, s));

/** A narrow completeness guard: explicit mandatory sentences cannot disappear. */
export function mandatoryRequirementAnchors(job) {
  return sourceFragmentCatalog(job).filter(fragment=>fragment.importance_hint==='MANDATORY'&&!fragment.context_only&&!fragment.work_format_only).map(fragment=>fragment.text);
}

export function missingMandatoryListItems(analysis, job) {
  const tokens = text => normalize(text).replace(/\beducation\b/g, 'degree').match(/[\p{L}\p{N}]+/gu) || [];
  const missing = [];
  for (const sentence of mandatoryRequirementAnchors(job)) {
    const list = sentence.match(/\bmandatory\s*:\s*(.*)/i)?.[1];
    if (!list) continue;
    for (const item of requirementItems(sentence, [null, 'mandatory', list])) {
      const wanted = tokens(item);
      if (!analysis.requirements.some(req => {
        const actual = new Set(tokens(`${req.requirement} ${req.skill || ''}`));
        return wanted.every(word => actual.has(word)) && quoted(req.source_quote, sentence);
      })) missing.push(item);
    }
  }
  return missing;
}

/** Constrain grammar to exact employer quotations and known candidate IDs. */
export function schemaForJob(job, profile) {
  const source = [job.title, job.description_text, job.location, job.country, job.work_mode].filter(Boolean).join('\n');
  const sentences = source.split(/(?<=[.!?;])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  const fragments = sentences.flatMap(sentence => [sentence, sentence.replace(/[.!?;]+$/, ''),
    ...sentence.split(/[,;:]|\s+and\s+/).map(s => s.trim()).filter(Boolean)]);
  const quotes = [...new Set(fragments)].slice(0, 1000);
  const ids = [...factIndex(profile).keys()];
  const schema = structuredClone(FIT_SCHEMA);
  schema.properties.requirements.items.properties.source_quote = quotes.length ? {enum: quotes} : {enum: ['UNKNOWN']};
  schema.properties.work_format.properties.evidence.items = quotes.length ? {enum: quotes} : {enum: ['UNKNOWN']};
  for (const field of ['matched_fact_ids','cv_focus_fact_ids']) schema.properties[field].items = ids.length ? {enum: ids} : {type: 'string', maxLength: 0};
  schema.properties.requirements.items.properties.candidate_evidence_fact_ids.items = ids.length ? {enum: ids} : {type: 'string', maxLength: 0};
  return schema;
}

/** Reject hallucinated IDs, false provenance and ungrounded employer evidence. */
export function validateFactIntegrity(analysis, profile, job) {
  analysis.work_format=normalizeWorkFormatUnknowns(analysis.work_format);
  if (!validateSchema(analysis)) throw new StructuredOutputError('Fit analysis JSON schema mismatch: '+validateSchema.errors.map(e=>`${e.instancePath} ${e.keyword} ${JSON.stringify(e.params)}`).join('; '));
  const facts = factIndex(profile);
  const source = [job.title, job.description_text, job.location, job.country, job.work_mode].filter(Boolean).join('\n');
  const allIds = [...analysis.matched_fact_ids, ...analysis.cv_focus_fact_ids];
  for (const req of analysis.requirements) {
    allIds.push(...req.candidate_evidence_fact_ids);
    if (!quoted(req.source_quote, source)) throw new StructuredOutputError('Requirement quote missing from vacancy');
    if (workFormatStatement(req.source_quote) && req.importance !== 'DESCRIPTION_ONLY')
      throw new StructuredOutputError('Work-format statement is employer evidence, not a candidate qualification');
    const categoryHint=sourceCategoryHint(req.source_quote);
    if(categoryHint&&req.category!==categoryHint)throw new StructuredOutputError(`Source qualification category must be ${categoryHint}: ${req.source_quote}`);
    const expectedProvenance = new Set();
    req.candidate_evidence_fact_ids.forEach(id => {
      const fact = facts.get(id);
      if (!fact) throw new StructuredOutputError('Unknown candidate evidence ID');
      if (fact.provenance) expectedProvenance.add(fact.provenance);
    });
    // Provenance is a set of evidence types in the master schema, not an ordered
    // parallel array. Every cited type must be true; repeated same-type facts
    // need only one type entry. Skills/languages imply no employment provenance.
    const statedProvenance = new Set(req.candidate_evidence_provenance.filter(Boolean));
    if (expectedProvenance.size !== statedProvenance.size || [...expectedProvenance].some(p => !statedProvenance.has(p)))
      throw new StructuredOutputError('False evidence provenance');
    if (['YES','PARTIAL'].includes(req.match) && !req.candidate_evidence_fact_ids.length)
      throw new StructuredOutputError('Positive match requires factual evidence');
    if (/\b(professional|commercial)\b/i.test(req.requirement) && req.min_years !== null && !req.professional_only)
      throw new StructuredOutputError('Professional years cannot use general experience');
  }
  for (const id of allIds) if (!facts.has(id)) throw new StructuredOutputError('Unknown candidate fact ID');
  for (const anchor of mandatoryRequirementAnchors(job)) {
    if (!analysis.requirements.some(req => quoted(req.source_quote, anchor)
      || quoted(anchor.replace(/[.!?;]+$/, ''), req.source_quote)))
      throw new StructuredOutputError(`Explicit mandatory requirement omitted: ${anchor}`);
  }
  if (missingMandatoryListItems(analysis, job).length)
    throw new StructuredOutputError(`Explicit mandatory list item omitted or merged without requirement mapping: ${missingMandatoryListItems(analysis, job).join('; ')}`);
  for (const quote of analysis.work_format.evidence)
    if (!quoted(quote, source)) throw new StructuredOutputError('Work-format quote missing from vacancy');
  if ((analysis.work_format.work_from_poland_allowed !== null || analysis.work_format.can_hire_in_poland !== null)
    && !analysis.work_format.evidence.length)
    throw new StructuredOutputError('Confirmed hiring eligibility requires vacancy evidence');
  const hiringEvidence = analysis.work_format.evidence.join(' ');
  if(explicitHybridQuote(job)&&analysis.work_format.hybrid_required!==true)
    throw new StructuredOutputError('Explicit hybrid vacancy requires hybrid_required=true; fully remote inference contradicts the source');
  for(const [field,expected] of Object.entries(groundedWorkNumbers(job,profile))){
    if(analysis.work_format[field]!==null&&analysis.work_format[field]!==expected)
      throw new StructuredOutputError(`Ungrounded work-format numeric value ${field}; use only explicit source frequency or base-city distance`);
  }
  const explicitPolishEmployment = explicitPolishRemoteEmployment.test(hiringEvidence);
  if (explicitPolishEmployment && (analysis.work_format.can_hire_in_poland !== true
    || analysis.work_format.employment_route !== 'PL_EMPLOYEE'))
    throw new StructuredOutputError('Explicit remote-from-Poland employment contract requires can_hire_in_poland=true and employment_route=PL_EMPLOYEE');
  if (explicitPolishEmployment && (analysis.work_format.remote_allowed !== true
    || normalize(analysis.work_format.remote_region) !== 'poland'
    || analysis.work_format.work_from_poland_allowed !== true))
    throw new StructuredOutputError('Explicit remote-from-Poland employment statement requires remote_allowed=true, remote_region=Poland and work_from_poland_allowed=true');
  if (analysis.work_format.can_hire_in_poland === true && !explicitPolishEmployment
    && !/\b(?:hire|hiring|employ|employment|contract|contractor|b2b|eor|employer of record)\b/i.test(hiringEvidence))
    throw new StructuredOutputError('can_hire_in_poland=true needs hiring-route evidence; remote location alone is insufficient');
  if (analysis.work_format.authorization_known_impossible && !analysis.requirements.some(req =>
    req.category === 'LEGAL' && req.importance === 'MANDATORY' && req.match === 'NO' && req.strict
    && authorizationCondition.test(req.source_quote)))
    throw new StructuredOutputError('Impossible authorization requires a grounded mandatory legal blocker');
  for (const blocker of analysis.hard_blockers) {
    const requirement = analysis.requirements[blocker.requirement_index];
    if (!requirement || requirement.importance !== 'MANDATORY' || requirement.match !== 'NO' || !requirement.strict)
      throw new StructuredOutputError('Hard blocker is not grounded in a strict mandatory failure');
  }
  return true;
}

/** Professional years remain in-domain and cannot be supplied by project facts. */
export function enforceProfessionalYears(requirements, profile) {
  const facts = factIndex(profile);
  return requirements.map(req => {
    if (!req.professional_only || req.min_years === null) return {...req};
    const cited = req.candidate_evidence_fact_ids.map(id => facts.get(id));
    const applicable = cited.filter(fact => fact?.provenance === 'PROFESSIONAL' && hasSkill(fact, req.skill));
    const knownYears = applicable.reduce((sum, fact) => sum + (Number(fact.duration_approx_years) || 0), 0);
    const full = req.min_years > 0 && knownYears >= req.min_years;
    const known = applicable.length > 0 && applicable.every(fact => Number.isFinite(fact.duration_approx_years));
    let match = full ? 'YES' : knownYears > 0 ? req.strict ? 'NO' : 'PARTIAL' : cited.length ? 'NO' : 'UNKNOWN';
    if (!full && applicable.length && !known) match = 'UNKNOWN';
    return {...req, match, professional_years_verified: knownYears,
      reason: full ? req.reason : 'Only verified in-domain PROFESSIONAL years count; project/R&D experience is separate.'};
  });
}

export function requiresCompletedDegree(text) {
  const value=normalize(text);
  const ongoing=/\b(?:currently\s+)?(?:pursuing|enrolled|studying|student)\b|degree in progress|ongoing (?:degree|study)|studium im bereich|laufende[snrm]? studium|immatrikuliert|etudiant[es]?|en cours (?:de|d')/i.test(value);
  // A disjunction allowing either current study or graduation does not demand
  // completion. An independent completed-degree AND further study still does.
  const completedAndStudy=/\b(?:completed|graduated|abgeschlossen\w*|diplome)\b.*\band\b.*\b(?:pursuing|enrolled|studying)\b/i.test(value);
  if(ongoing&&!completedAndStudy)return false;
  return /\b(?:completed|bachelor|master|degree|bsc|msc|graduated|abgeschlossen\w*|diplome|titulaire)\b/i.test(value);
}
export function enforceEducation(requirements, profile) {
  const facts = factIndex(profile);
  return requirements.map(req => {
    if (req.category !== 'EDUCATION' || !requiresCompletedDegree(req.source_quote??req.requirement)) return req;
    const cited = req.candidate_evidence_fact_ids.map(id => facts.get(id));
    if (cited.some(fact => fact?.provenance === 'EDUCATION' && ['completed','graduated','degree_completed'].includes(fact.status))) return req;
    if (cited.some(fact => fact?.provenance === 'EDUCATION' && fact.status === 'degree_in_progress'))
      return {...req, match: req.strict ? 'NO' : 'PARTIAL', reason: 'Degree in progress cannot be represented as a completed degree.'};
    return {...req, match: 'UNKNOWN', reason: 'No verified completed degree evidence.'};
  });
}

/** Compare declared CEFR levels without inventing a certificate requirement. */
export function enforceLanguageLevels(requirements, profile) {
  const levels = ['A1','A2','B1','B2','C1','C2'];
  return requirements.map(req => {
    if (req.category !== 'LANGUAGE' || /\b(certificate|certification|exam|ielts|toefl)\b/i.test(req.requirement)) return req;
    const required = req.requirement.match(/\b(A1|A2|B1|B2|C1|C2)\b/i)?.[1]?.toUpperCase();
    if (!required) return req;
    const language = (profile.languages || []).find(fact => quoted(fact.language, req.requirement));
    const candidateLevel = String(language?.level || '').toUpperCase();
    if (!language || !levels.includes(candidateLevel)) return req;
    const meets = levels.indexOf(candidateLevel) >= levels.indexOf(required);
    return {...req, match: meets ? 'YES' : req.strict ? 'NO' : 'PARTIAL',
      candidate_evidence_fact_ids: [language.id], candidate_evidence_provenance: [],
      genuinely_ambiguous: false,
      reason: `Declared ${language.language} ${candidateLevel}; vacancy requires ${required}. No certificate claim made.`};
  });
}

/** Bounded factual qualifier guards; never equate project work with employment. */
export function enforceSkillQualifiers(requirements,profile) {
  const facts=factIndex(profile);
  const evidence=fact=>[...(fact?.statements??[]),...(fact?.skills??[])].map(value=>typeof value==='string'?value:JSON.stringify(value)).join(' ');
  return requirements.map(req=>{
    if(req.category!=='TECHNICAL'||req.match!=='YES')return req;
    const text=normalize(req.source_quote??req.requirement),cited=req.candidate_evidence_fact_ids.map(id=>facts.get(id));
    const citedText=cited.map(evidence).join(' ');
    if(/\b(?:agile|scrum)\b/.test(text)&&!/\b(?:agile|scrum)\b/i.test(citedText))
      return{...req,match:'UNKNOWN',reason:'Cited facts contain no documented agile/Scrum environment; project work alone does not establish it.',semantic_qa:'UNSUPPORTED_AGILE_ENVIRONMENT'};
    if(/c\+\+/.test(text)&&/\b(?:proficien\w*|strong|expert|advanced|excellent)\b/.test(text)){
      const supporting=cited.filter(f=>/c\+\+/i.test(evidence(f)));
      if(!supporting.length)return{...req,match:'UNKNOWN',reason:'No cited C++ evidence supports this proficiency requirement.',semantic_qa:'UNSUPPORTED_CPP_PROFICIENCY'};
      if(supporting.every(f=>/basic|intermediate|concept|familiarity|limited/i.test(evidence(f))))
        return{...req,match:'PARTIAL',reason:'Documented C++ evidence is limited to basic/intermediate concepts; strong proficiency is not established.',semantic_qa:'CPP_QUALIFIER_EXCEEDS_FACT'};
    }
    if(/\b(?:ubuntu|linux)\b/.test(text)&&/\b(?:previous experience|experience (?:working|using|with)|hands-on experience)\b/.test(text)){
      const supporting=cited.filter(f=>/\b(?:ubuntu|linux)\b/i.test(evidence(f)));
      if(supporting.length&&supporting.every(f=>f.type==='verified_skill'&&/familiarity|basic|limited/i.test(evidence(f))))
        return{...req,match:'PARTIAL',reason:'Only Linux familiarity is documented; prior hands-on distribution work is not established.',semantic_qa:'LINUX_EXPERIENCE_EXCEEDS_FACT'};
    }
    return req;
  });
}

/** N/A removes absent categories; importance groups are normalized inside each category. */
export function scoreRequirements(requirements, {weights = defaultWeights} = {}) {
  const values = {YES: 1, PARTIAL: 0.5, NO: 0};
  const breakdown = {};
  let denominator = 0, total = 0, counted = 0;
  for (const [category, weight] of Object.entries(weights)) {
    const rows = requirements.filter(req => req.category === category && importanceWeights[req.importance] > 0);
    if (!rows.length) { breakdown[category] = 'N/A'; continue; }
    let weighted = 0, active = 0;
    for (const [importance, importanceWeight] of Object.entries(importanceWeights)) {
      const group = rows.filter(req => req.importance === importance);
      if (!group.length || !importanceWeight) continue;
      weighted += importanceWeight * group.reduce((sum, req) => sum + (req.match === 'UNKNOWN'
        ? req.genuinely_ambiguous ? 0.25 : 0 : values[req.match] ?? 0), 0) / group.length;
      active += importanceWeight;
    }
    const result = 100 * weighted / active;
    breakdown[category] = Math.round(result * 100) / 100;
    total += result * weight; denominator += weight; counted += rows.length;
  }
  return {technical_fit: breakdown.TECHNICAL ?? 'N/A', experience_fit: breakdown.PROFESSIONAL_EXPERIENCE ?? 'N/A',
    education_fit: breakdown.EDUCATION ?? 'N/A', language_fit: breakdown.LANGUAGE ?? 'N/A',
    overall_fit: denominator ? Math.round(total / denominator * 100) / 100 : null,
    category_scores: breakdown, active_weight: denominator, scored_requirements: counted,
    mandatory_unknown: requirements.some(req => req.importance === 'MANDATORY' && req.match === 'UNKNOWN')};
}

const european = new Set(['poland','germany','czechia','czech republic','austria','netherlands','sweden','norway','finland','denmark','france','belgium','spain','portugal','italy','ireland','romania','bulgaria','hungary','slovakia','slovenia','croatia','estonia','latvia','lithuania','luxembourg','greece','cyprus','malta','iceland','switzerland','united kingdom','uk']);
const euCountries = new Set([...european].filter(c => !['norway','iceland','switzerland','united kingdom','uk'].includes(c)));
const countryCodes = {pl:'poland',de:'germany',cz:'czechia',at:'austria',nl:'netherlands',se:'sweden',no:'norway',fi:'finland',dk:'denmark',fr:'france',be:'belgium',es:'spain',pt:'portugal',it:'italy',ie:'ireland',ro:'romania',bg:'bulgaria',hu:'hungary',sk:'slovakia',si:'slovenia',hr:'croatia',ee:'estonia',lv:'latvia',lt:'lithuania',lu:'luxembourg',gr:'greece',cy:'cyprus',mt:'malta',is:'iceland',ch:'switzerland',gb:'united kingdom',uk:'united kingdom',us:'united states'};
const countryName = value => countryCodes[normalize(missingString(value))] || normalize(missingString(value));
const knownNonlocalPolishCity=/\b(?:warsaw|warszawa|krakow|poznan|gdansk|gdynia|katowice|lodz|szczecin|lublin|bialystok|rzeszow|bydgoszcz|torun|olsztyn|kielce|sopot|opole|legnica|walbrzych)\b/;
function mandatoryTravelQuote(job,catalog){return String(job.description_text??'').split(/\n|(?<=[.!?])\s+/).find(text=>
 !/\b(?:no|not|without)\s+(?:business\s+)?travel|travel\s+(?:is\s+)?(?:not\s+required|optional)|\b(?:preferred|nice to have|optional)\b/i.test(text)&&
 /\b(?:business\s+)?travel\s+(?:is\s+)?(?:required|mandatory)|\b(?:required|mandatory)\s+(?:business\s+)?travel|\bavailability\s+for\s+(?:business\s+)?travel|\b(?:willingness|ability)\s+to\s+travel|(?:wymagane|obowiazkowe|obowiązkowe)\s+(?:podroze|podróże|delegacje)/i.test(text)&&
 !['NICE_TO_HAVE','STRONG_PREFERENCE'].includes((catalog??sourceFragmentCatalog(job)).find(fragment=>fragment.text===text.trim()||text.includes(fragment.text))?.importance_hint));}

export function deterministicHardReject({job,profile,policy={}}){
 const loc=policy.work_location_policy??{};const proofs=[];const blockers=[];
 if(policy.hard_reject_gate?.enabled!==true&&loc.no_relocation!==true&&loc.exclude_onsite!==true)return null;
 const add=(code,sourceQuote,field,authority)=>{blockers.push(code);proofs.push({code,source_quote:sourceQuote,source_field:field,source_url:job.canonical_url??null,...authority});};
 if(policy.excluded_job_ids?.includes(job.job_id))add(policy.job_scope_exclusion_reasons?.[job.job_id]??'USER_EXCLUDED_VACANCY',job.location??job.title,'location',
  {policy_source:'search_policy.excluded_job_ids',verified_policy_fact:{job_id:job.job_id,authority:'USER_REQUESTED_CURRENT_JOB_SCOPE_EXCLUSION'}});
 const fragments=sourceFragmentCatalog(job).filter(item=>!item.list_container&&!item.context_only);
 const base=loc.required_base??loc.candidate_base??profile.candidate?.base_location??{city:'Wroclaw',country:'Poland'};
 const location=normalize(job.location),country=countryName(job.country),formatEvidence=explicitWorkMode(job),mode=formatEvidence.mode;
 if(loc.exclude_onsite===true&&mode==='ONSITE')add('ONSITE_WORK_EXCLUDED',formatEvidence.quote,formatEvidence.source_field,{policy_source:'work_location_policy.exclude_onsite',verified_policy_fact:true});
 const numbers=groundedWorkNumbers(job,profile);const local=location.split(/[,;]/).some(part=>part.trim()===normalize(base.city))||
  numbers.office_distance_km!==null&&numbers.office_distance_km<=(loc.local?.radius_km??30)&&country==='poland';
 const nonlocal=country&&country!=='poland'||!local&&(knownNonlocalPolishCity.test(location)||numbers.office_distance_km!==null&&numbers.office_distance_km>(loc.local?.radius_km??30));
 const explicitPhysical=explicitHybridQuote(job)||fragments.find(f=>/\b(?:role|position|job|internship)\b[^.!?]*\b(?:on[- ]?site|in[- ]?office)\b|presence\s+(?:on\s+site|at\s+the\s+office)\s+is\s+required|praca\s+stacjonarna|prasenz\s+vor\s+ort\s+ist\s+erforderlich/i.test(normalize(f.text)))?.text;
 if(loc.no_relocation===true&&(mode==='HYBRID'||mode==='ONSITE'||explicitPhysical)&&!local&&nonlocal){
  add('NONLOCAL_PRESENCE_INELIGIBLE',explicitPhysical??job.work_mode,explicitPhysical?'description_text':'work_mode',
   {location_source_quote:job.location??job.country,policy_source:'work_location_policy.required_base / no_relocation',verified_policy_fact:base});
 }
 const relocation=fragments.find(f=>!/\b(?:preferred|optional|not required|assistance|support|benefit)\b/i.test(f.text)&&/\b(?:must|requires?|mandatory|required|willingness)\b[^.!?]*\brelocat|\brelocation\s+(?:is\s+)?(?:required|mandatory)/i.test(f.text));
 if(loc.no_relocation===true&&relocation)add('NO_RELOCATION_USER_POLICY',relocation.text,'description_text',{policy_source:'work_location_policy.no_relocation',verified_policy_fact:true});
 const travel=mandatoryTravelQuote(job,fragments);
 if(loc.forbid_mandatory_travel===true&&/\btravel[-\s]+required\b|\bmandatory[-\s]+travel\b/i.test(job.location??'')&&!/\bno\s+(?:business\s+)?travel|travel\s+(?:is\s+)?not\s+required/i.test(job.description_text??''))
  add('MANDATORY_TRAVEL_INELIGIBLE',job.location,'location',{policy_source:'work_location_policy.forbid_mandatory_travel',verified_policy_fact:true});
 if(loc.forbid_mandatory_travel===true&&travel)add('MANDATORY_TRAVEL_INELIGIBLE',travel,'description_text',{policy_source:'work_location_policy.forbid_mandatory_travel',verified_policy_fact:true});
 const remoteRestriction=fragments.find(f=>{
  const text=normalize(f.text);const explicit=/\bmust\s+(?:reside|live|be based|be located|work from)\b|\b(?:only|exclusively)\s+(?:open|available|offered)\s+to\s+(?:applicants|candidates|residents)\b|\b(?:candidates|applicants|employees)\b[^.!?]*\b(?:resid(?:e|ing)|based|located)\b[^.!?]*\bonly\b|\b(?:remote|role|position|job)\b[^.!?]*\b(?:united states|usa|us|canada|germany|romania|uk|australia)\s+only\s*[.!?]?$/i.test(text)||
   /\b(?:remote|role|position|job|work|applicants|candidates)\b[^.!?]*\b(?:excluding|excluded|except|not available (?:in|from))\b[^.!?]*\bpoland\b/.test(text);
  const excludesPoland=/\b(?:excluding|excluded|except|not available (?:in|from))\b[^.!?]*\bpoland\b/.test(text);
  const abroadOnly=/\b(?:united states|usa|us|canada|germany|romania|united kingdom|uk|australia|new zealand)\b/.test(text)&&!/\b(?:poland|worldwide|anywhere|eu|europe|eea|emea|globally)\b/.test(text);
  const nonlocalCity=/\bmust\s+(?:reside|live|be based|be located)\s+(?:in\s+)?(?:warsaw|warszawa|krakow|poznan|gdansk|katowice|lodz)\b/.test(text);
  return explicit&&(excludesPoland||abroadOnly||nonlocalCity);
 });
 if(remoteRestriction&&loc.no_relocation===true)add('REMOTE_COUNTRY_LOCKED_INELIGIBLE',remoteRestriction.text,'description_text',{policy_source:'work_location_policy.required_base',verified_policy_fact:base});
 if(loc.no_relocation===true&&mode==='REMOTE'&&/^remote\s+from\s+(?:the\s+)?(?:us|usa|united states|germany|romania|canada|australia|uk|united kingdom)\b/.test(location)&&!/\b(?:poland|pl|worldwide|anywhere|europe|eu|eea|emea)\b/.test(location))
  add('REMOTE_COUNTRY_LOCKED_INELIGIBLE',job.location,'location',{policy_source:'work_location_policy.required_base',verified_policy_fact:base});
 const professional=(profile.experience??[]).filter(fact=>fact.provenance==='PROFESSIONAL');
 const bound=professional.length&&professional.every(f=>Number.isFinite(f.duration_approx_years))?professional.reduce((sum,f)=>sum+f.duration_approx_years,0):null;
 if(bound!==null)for(const fragment of fragments){
  if(fragment.importance_hint!=='MANDATORY'||!/(?:professional|commercial)\b|(?:profesjonaln|zawodow|komercyjn)[\p{L}]*/iu.test(fragment.text)||/\b(?:preferred|nice[- ]to[- ]have|optional|ideally|preferowane|opcjonalne|atut)\b|mile widziane/i.test(fragment.text))continue;
  const min=fragment.text.match(/\b(\d+(?:\.\d+)?)\s*(?:\+|or more)?\s*(?:years?|yrs?|lat|lata|letni[\p{L}]*|rok|roku)\b/iu)?.[1];
  if(min&&Number(min)>bound)add('VERIFIED_PROFESSIONAL_YEARS_INSUFFICIENT',fragment.text,'description_text',
   {candidate_fact_ids:professional.map(f=>f.id),verified_candidate_fact:{professional_years:bound,provenance:'PROFESSIONAL',source:'candidate_profile.experience'},required_professional_years:Number(min)});
 }
 if(!blockers.length)return null;
 const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 return{decision:'REJECT',overall_fit:null,application_priority:0,requirements:[],hard_blockers:[...new Set(blockers)],
  reasons:[...new Set(blockers)],hard_reject_proof:proofs,analysis_method:'DETERMINISTIC_HARD_GATE',model:null,provider:null,
  runtime_statistics:null,inference_performed:false,profile_hash:hash(profile),policy_hash:hash(policy),job_content_hash:job.content_hash,
  policy_version:policy.policy_version??null,work_format_class:blockers[0],eligible_for_auto_apply:false,
  employment_eligibility:{blocker:true,reason:blockers.join('; '),work_from_poland_allowed:null},
  prompt_version:'DETERMINISTIC_HARD_GATE_v1'};
}

export function workFormatAnalysis({job, profile, policy = {}, workFormat}) {
  const f = normalizeWorkFormatUnknowns(workFormat || {});
  if(explicitHybridQuote(job))f.hybrid_required=true;
  const groundedNumbers=groundedWorkNumbers(job,profile);
  for(const [field,expected] of Object.entries(groundedNumbers))if(f[field]!==expected)f[field]=expected;
  const loc = policy.work_location_policy || {};
  const country = countryName(f.office_country || job.country || (/\bpoland\b/i.test(job.location??'')?'Poland':null));
  const city = normalize(f.office_location || job.location);
  const noRelocation=loc.no_relocation===true;
  const base = loc.required_base || profile.candidate?.base_location || loc.candidate_base || {city: 'Wroclaw', country: 'Poland'};
  const baseCity = normalize(base.city);
  const local = (city === baseCity || city.includes(`${baseCity},`) || city.includes(`${baseCity} `)||city.split(/[,;]/).some(item=>item.trim()===baseCity))
    || (typeof f.office_distance_km === 'number' && f.office_distance_km <= (loc.local?.radius_km ?? 30) && country === 'poland');
  const region = normalize(missingString(f.remote_region));
  const residency = normalize(missingString(f.employee_residency_requirement));
  const nonlocalResidency=noRelocation&&knownNonlocalPolishCity.test(residency)&&/\b(?:must|required|only)\b/.test(residency)&&!/\bwroclaw\b|anywhere|all (?:of )?poland/.test(residency);
  const reasons = []; let classification = 'UNKNOWN', feasible = false, blocker = false;
  const regularOnsite = (f.onsite_days_per_week ?? 0) > 0 || (f.onsite_days_per_month ?? 0) > 1;
  const declaredMode=explicitWorkMode(job).mode;
  const verifiedRegions=job.metadata?.validated_applicant_locations??[];
  if(declaredMode==='REMOTE'&&verifiedRegions.some(r=>/^(?:poland|polska|pl|europe|european union|eu|eea|emea|worldwide|global|anywhere)$/i.test(String(r).trim()))){
    f.remote_allowed??=true;f.hybrid_required??=false;f.work_from_poland_allowed??=true;
  }
  if(noRelocation&&declaredMode==='HYBRID')f.hybrid_required=true;
  if(noRelocation&&declaredMode==='ONSITE'){f.remote_allowed=false;f.hybrid_required=false;}
  const physicalRequired=f.hybrid_required===true||f.remote_allowed===false||regularOnsite||['HYBRID','ONSITE'].includes(declaredMode);
  const knownNonlocal=Boolean(country&&country!=='poland'||!local&&(knownNonlocalPolishCity.test(city)||typeof f.office_distance_km==='number'&&f.office_distance_km>(loc.local?.radius_km??30)));
  const requiredTravel=Boolean(mandatoryTravelQuote(job));
  if(loc.exclude_onsite===true&&(declaredMode==='ONSITE'||f.remote_allowed===false&&f.hybrid_required===false)){classification='ONSITE_WORK_EXCLUDED';blocker=true;reasons.push('ONSITE_WORK_EXCLUDED');}
  else if(noRelocation&&f.relocation_required===true){classification='RELOCATION_INELIGIBLE';blocker=true;reasons.push('NO_RELOCATION_USER_POLICY');}
  else if(loc.forbid_mandatory_travel===true&&(f.business_travel_required===true||requiredTravel)){
    classification='MANDATORY_TRAVEL_INELIGIBLE';blocker=true;reasons.push('MANDATORY_TRAVEL_INCOMPATIBLE_WITH_WROCLAW_BASE');
  } else if(noRelocation&&physicalRequired&&!local&&knownNonlocal){
    classification='NONLOCAL_PRESENCE_INELIGIBLE';blocker=true;reasons.push('PHYSICAL_BASE_WROCLAW_REQUIRED','NONLOCAL_OFFICE_PRESENCE_REQUIRED');
  } else if(noRelocation&&physicalRequired&&!local){
    reasons.push('OFFICE_LOCATION_REQUIRES_VERIFICATION');
  } else if (f.remote_allowed === true && (!noRelocation&&!f.hybrid_required||f.hybrid_required===false) && !regularOnsite&&!['HYBRID','ONSITE'].includes(declaredMode)) {
    if (nonlocalResidency||(residency && !/\b(poland|pl|eu|europe|eea|emea|worldwide)\b/.test(residency)) || f.work_from_poland_allowed === false) {
      classification = 'REMOTE_COUNTRY_LOCKED_INELIGIBLE'; blocker = true; reasons.push('REMOTE_COUNTRY_LOCKED_INELIGIBLE');
    } else if (f.work_from_poland_allowed === true) {
      classification = /world|anywhere|global/.test(region) ? 'REMOTE_WORLDWIDE_FROM_POLAND'
        : /eu|europe|eea|emea/.test(region) ? 'REMOTE_EUROPE_FROM_POLAND' : /poland|\bpl\b/.test(region)||noRelocation ? 'REMOTE_POLAND' : 'UNKNOWN';
      feasible = classification !== 'UNKNOWN';
    }
  } else if (local && f.hybrid_required === true) {
    classification = 'HYBRID_WROCLAW_LOCAL'; feasible = loc.local?.hybrid_enabled !== false;
  } else if (local && f.remote_allowed === false && f.hybrid_required === false) {
    classification = 'ONSITE_WROCLAW_LOCAL'; feasible = loc.local?.onsite_auto_apply === true;
    if (!feasible) reasons.push('LOCAL_ONSITE_REVIEW');
  } else if (country === 'poland' && f.hybrid_required === true && (f.onsite_days_per_week===null||f.onsite_days_per_week===0)
    && f.onsite_days_per_month !== null && f.onsite_days_per_month !== undefined
    && f.onsite_days_per_month <= (loc.poland_nonlocal?.max_onsite_days_per_month_for_auto_apply ?? 1)) {
    classification = 'HYBRID_POLAND_RARE_TRAVEL'; feasible = loc.poland_nonlocal?.rare_travel_enabled !== false;
  } else if(country==='poland'&&f.hybrid_required===true&&!local){
    classification='HYBRID_POLAND_NONLOCAL_REVIEW';reasons.push('POLAND_NONLOCAL_HYBRID_REVIEW');
  } else if (country && (f.hybrid_required === true || f.remote_allowed === false)) {
    classification = european.has(country) ? (f.hybrid_required ? 'HYBRID_EUROPE_RELOCATION_REVIEW' : 'ONSITE_EUROPE_RELOCATION_REVIEW') : 'NON_EU_RELOCATION_REVIEW';
    const allowed = loc.relocation?.allowed_countries?.map(countryName).includes(country)
      || loc.relocation?.allowed_cities?.map(normalize).includes(city);
    feasible = allowed === true && profile.onboarding?.relocation_willing === true;
    if (!feasible) reasons.push('RELOCATION_NOT_PREAPPROVED');
  }
  if (classification === 'UNKNOWN') reasons.push('WORK_FORMAT_UNKNOWN');
  let hireConfirmed = false;
  const route = f.employment_route || 'UNKNOWN';
  if (route === 'PL_EMPLOYEE') hireConfirmed = f.can_hire_in_poland === true;
  else if (route === 'EOR') hireConfirmed = f.can_hire_in_poland === true && profile.onboarding?.eor_willing === true;
  else if (route === 'B2B') hireConfirmed = f.can_hire_in_poland === true && profile.onboarding?.b2b_willing === true;
  else if (route === 'CONTRACTOR') hireConfirmed = f.can_hire_in_poland === true && profile.onboarding?.contractor_willing === true;
  else if (route === 'RELOCATION') hireConfirmed = feasible && profile.candidate?.eu_citizen === true && euCountries.has(country);
  if(noRelocation&&route==='RELOCATION'){hireConfirmed=false;blocker=true;feasible=false;reasons.push('NO_RELOCATION_USER_POLICY');}
  if (!hireConfirmed) reasons.push(['B2B','CONTRACTOR','EOR'].includes(route) ? 'HIRING_ARRANGEMENT_NOT_PREAPPROVED' : 'EMPLOYMENT_ROUTE_UNKNOWN');
  if (f.authorization_known_impossible) {blocker = true; reasons.push('WORK_AUTHORIZATION_IMPOSSIBLE');}
  // Citizenship alone never confirms a non-EU permit or regulated status.
  if (f.work_authorization_required && ['uk','united kingdom','switzerland'].includes(country)) {
    const known = country === 'switzerland' ? profile.onboarding?.switzerland_work_authorization : profile.onboarding?.uk_work_authorization;
    if (known !== true && f.sponsorship_available !== true) {hireConfirmed = false; reasons.push('NON_EU_WORK_AUTHORIZATION_UNKNOWN');}
  }
  if (f.security_clearance_requirement || f.export_control_requirement) {hireConfirmed = false; reasons.push('SPECIAL_AUTHORIZATION_REVIEW');}
  const locationCompatible=!blocker&&(/REMOTE_.*FROM_POLAND|REMOTE_POLAND/.test(classification)||['HYBRID_WROCLAW_LOCAL','ONSITE_WROCLAW_LOCAL'].includes(classification));
  return {work_format_class: classification, eligible_for_discovery: true,
    location_policy_status:blocker?'INCOMPATIBLE':locationCompatible?'COMPATIBLE':'UNVERIFIED',
    eligible_for_auto_apply: feasible && hireConfirmed && !blocker, reasons,
    employment_eligibility: {candidate_citizenship: profile.candidate?.citizenship || [], candidate_eu_citizen: profile.candidate?.eu_citizen === true,
      work_from_poland_allowed: f.work_from_poland_allowed ?? null, hire_route: route, blocker, reason: reasons.join('; ')}};
}

export function routeAnalysis({job, profile, policy = {}, analysis, score}) {
  const result = score || scoreRequirements(analysis.requirements, {weights: policy.qualification_weights || defaultWeights});
  const work = workFormatAnalysis({job, profile, policy, workFormat: analysis.work_format});
  const reasons = [...work.reasons];
  const threshold = policy.thresholds || {};
  let decision = result.overall_fit === null ? 'REVIEW' : result.overall_fit >= (threshold.auto_apply ?? 78) ? 'AUTO_APPLY'
    : result.overall_fit >= (threshold.review ?? 60) ? 'REVIEW' : result.overall_fit >= (threshold.stretch ?? 45) ? 'STRETCH' : 'REJECT';
  if (!result.scored_requirements) {decision = 'REVIEW'; reasons.push('INSUFFICIENT_JOB_INFORMATION');}
  if (decision === 'AUTO_APPLY' && !work.eligible_for_auto_apply) decision = 'REVIEW';
  if (result.mandatory_unknown) {if (decision === 'AUTO_APPLY') decision = 'REVIEW'; reasons.push('MANDATORY_UNKNOWN');}
  if (job.availability_status !== 'OPEN' && decision === 'AUTO_APPLY') {decision = 'REVIEW'; reasons.push('VACANCY_NOT_VERIFIED_OPEN');}
  if (job.material_fact_unknown && decision === 'AUTO_APPLY') {decision = 'REVIEW'; reasons.push('MATERIAL_APPLICATION_FACT_UNKNOWN');}
  const blocked = analysis.hard_blockers?.length > 0 || work.employment_eligibility.blocker
    || analysis.requirements.some(qualificationBlocker)
    || (policy.excluded_companies || []).some(company => normalize(company) === normalize(job.company))
    || (policy.excluded_countries || []).some(country => normalize(country) === normalize(job.country))
    || (policy.excluded_job_ids || []).includes(job.job_id);
  if (blocked) {decision = 'REJECT'; reasons.push('HARD_BLOCKER');}
  if (job.availability_status === 'CLOSED') {decision = 'REJECT'; reasons.push('JOB_CLOSED');}
  if (job.already_applied || job.duplicate_application) {decision = 'REJECT'; reasons.push('DUPLICATE_APPLICATION');}
  if (job.company_spam_guard && decision === 'AUTO_APPLY') {decision = 'REVIEW'; reasons.push('COMPANY_SPAM_GUARD');}
  return {...analysis, ...result, ...work, decision, reasons: [...new Set(reasons)],
    application_priority: result.overall_fit === null ? 0 : Math.round(result.overall_fit * (work.eligible_for_auto_apply ? 1 : 0.85)),
    prompt_version: PROMPT_VERSION};
}

export async function analyzeJob({job, profile, policy = {}, llm = new OllamaClient()}) {
  const hard=deterministicHardReject({job,profile,policy});if(hard)return hard;
  if(process.env.FIT_EVALUATION_MODE==='fast' && llm instanceof OllamaClient){
    const {analyzeFastFit}=await import('./fit-fast.mjs');
    return analyzeFastFit({job,profile,policy,llm});
  }
  const compact = llm instanceof OllamaClient || llm.wireFormat === 'compact';
  const system = await readFile(new URL(compact ? '../../prompts/fit_analysis_compact.md' : '../../prompts/fit_analysis.md', import.meta.url), 'utf8');
  const catalog = compact ? sourceFragmentCatalog(job) : null;
  const sourceOrder = compact ? qualificationSentences(job.description_text || '',{job}).map(sentence =>
    catalog.find(fragment => fragment.text === sentence.text)?.id) : null;
  const completeCatalog = compact && sourceOrder.every(Number.isInteger);
  const compactCatalog = compact ? catalog.map(fragment => ({id:fragment.id, text:fragment.text,
    ...(fragment.importance_hint ? {importance_hint:fragment.importance_hint} : {}),
    ...(fragment.list_container ? {list_container:true} : {}),
    ...(fragment.work_format_only ? {work_format_only:true} : {}),
    ...(fragment.context_only ? {context_only:true} : {}),
    ...(fragment.category_hint ? {category_hint:fragment.category_hint} : {}),
    ...(fragment.conditional_region ? {conditional_region:fragment.conditional_region} : {})})) : null;
  const schema = compact ? compactSchemaForJob(job, profile, catalog) : schemaForJob(job, profile);
  const prompt = JSON.stringify({candidate_facts: [...factIndex(profile).values()],
    candidate: profile.candidate, onboarding: profile.onboarding, search_policy: policy,
    explicit_requirement_sentences_to_cover: mandatoryRequirementAnchors(job),
    ...(compact ? {explicit_source_fragment_ids_to_cover: catalog.filter(fragment =>
      fragment.importance_hint && !fragment.list_container).map(fragment => fragment.id),
      maximum_additional_requirement_rows:schema.properties.requirements.maxProperties} : {}),
    ...(compact ? {source_fragments_untrusted_data: compactCatalog, vacancy_source_sentence_order:sourceOrder} : {}),
    untrusted_quoted_vacancy_data: {title: job.title,
      ...(!completeCatalog ? {description_text:job.description_text} : {}),
      location: job.location, country: job.country, work_mode: job.work_mode}});
  const outputRows = compact ? schema.properties.requirements.maxProperties + schema.properties.explicit_requirements.required.length : 0;
  const request = {system, prompt, schema,
    numCtx: compact && prompt.length < 20000 ? 8192 : 16384,
    numPredict: compact ? Math.max(2200, Math.min(16000, 600 + outputRows * 180)) : undefined,
    repairInstruction: compact ? 'Fill EVERY required explicit_requirements key with a factual match, UNKNOWN if evidence is missing. The requirements object is ONLY for additional IDs, never duplicate an explicit key. Never generate source quotes or provenance.' : undefined,
    validate: output => compact ? expandCompactAnalysis(output, {job, profile, catalog}) : validateFactIntegrity(output, profile, job)};
  const output = typeof llm === 'function' ? await llm(request) : await llm.json(request);
  const raw = compact ? expandCompactAnalysis(output, {job, profile, catalog}) : output;
  // An explicitly injected test gateway must satisfy exactly the same truth boundary.
  validateFactIntegrity(raw, profile, job);
  const disciplined = enforceSkillQualifiers(enforceLanguageLevels(enforceEducation(enforceProfessionalYears(raw.requirements, profile), profile), profile), profile);
  const analysis = {...raw, requirements: disciplined,
    hard_blockers: disciplined.flatMap((req, index) => qualificationBlocker(req)
      ? [{requirement_index: index, reason: req.reason}] : [])};
  return routeAnalysis({job, profile, policy, analysis});
}

export function reusableAnswer(memory, key, context = {}) {
  return (memory.answers || []).find(answer => answer.key === key && answer.source === 'USER'
    && answer.reusable === true && answer.reuse_approved === true
    && Object.entries(answer.scope || {}).every(([name, value]) => context[name] === value)) || null;
}
