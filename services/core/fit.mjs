import {readFile} from 'node:fs/promises';
import Ajv from 'ajv';
import {OllamaClient, StructuredOutputError} from './llm.mjs';

export const PROMPT_VERSION = 'fit-analysis-v2.2-compact';
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

export const FIT_SCHEMA = object({
  role_family: string, role_level: string,
  hard_blockers: {type: 'array', items: object({requirement_index: {type: 'integer', minimum: 0}, reason: string})},
  requirements: {type: 'array', maxItems: 100, items: object({
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
  requirements: {type: 'array', maxItems: 20, items: object({
    source_fragment_id: {type: 'integer', minimum: 0},
    importance: {enum: Object.keys(importanceWeights)}, category: {enum: categories},
    candidate_evidence_fact_ids: {type: 'array', maxItems: 4, uniqueItems: true, items: string},
    match: {enum: ['YES','PARTIAL','NO','UNKNOWN']}, reason: {type: 'string', maxLength: 160},
    skill: nullableString, strict: {type: 'boolean'}
  })}, work_format: object(compactWorkProperties)
});
const validateCompactSchema = new Ajv({strict: true, allErrors: true}).compile(COMPACT_FIT_SCHEMA);

export function compactSchemaForJob(job, profile, catalog = sourceFragmentCatalog(job)) {
  const schema = structuredClone(COMPACT_FIT_SCHEMA);
  const ids = [...factIndex(profile).keys()];
  const requirementIds = catalog.filter(f => !f.list_container).map(f => f.id);
  schema.properties.requirements.items.properties.source_fragment_id = requirementIds.length ? {enum: requirementIds} : {type: 'integer', minimum: 0};
  schema.properties.requirements.items.properties.candidate_evidence_fact_ids.items = ids.length ? {enum: ids} : {type: 'string', maxLength: 0};
  schema.properties.work_format.properties.evidence_fragment_ids.items = catalog.length ? {enum: catalog.map(f => f.id)} : {type: 'integer', minimum: 0};
  return schema;
}

/** IDs refer to original contiguous text, avoiding generated quotations entirely. */
export function sourceFragmentCatalog(job) {
  const source = [job.title, job.description_text, job.location, job.country, job.work_mode].filter(Boolean).join('\n');
  const catalog = []; const seen = new Map();
  const add = (text, importance_hint = null, list_container = false) => {
    text = text.trim();
    if (!text) return;
    if (seen.has(text)) {
      const entry = catalog[seen.get(text)];
      if (importance_hint) entry.importance_hint = importance_hint;
      return;
    }
    const entry = {id: catalog.length, text, importance_hint, list_container};
    seen.set(text, entry.id); catalog.push(entry);
  };
  for (const sentence of source.split(/(?<=[.!?;])\s+|\n+/).map(s => s.trim()).filter(Boolean)) {
    const list = sentence.match(/\b(mandatory|nice to have|preferred)\s*:\s*(.*)/i);
    const hint = list ? /mandatory/i.test(list[1]) ? 'MANDATORY' : /nice/i.test(list[1]) ? 'NICE_TO_HAVE' : 'STRONG_PREFERENCE'
      : /\b(required|must have|essential)\b/i.test(sentence) && !/not required/i.test(sentence) ? 'MANDATORY' : null;
    const items = list ? list[2].replace(/[.!?;]+$/, '').split(/,|\s+and\s+/).map(s => s.trim()).filter(Boolean) : [];
    add(sentence, hint, items.length > 1);
    for (const item of items) add(item, hint);
  }
  return catalog;
}

export function expandCompactAnalysis(wire, {job, profile, catalog = sourceFragmentCatalog(job)}) {
  if (!validateCompactSchema(wire)) throw new StructuredOutputError('Compact fit JSON schema mismatch');
  const facts = factIndex(profile);
  const fragment = id => {
    const value = catalog[id];
    if (!value || value.id !== id) throw new StructuredOutputError('Unknown source fragment ID');
    return value;
  };
  const requirements = wire.requirements.map(req => {
    const source = fragment(req.source_fragment_id);
    if (source.list_container) throw new StructuredOutputError('Mandatory or preferred list must map each item separately');
    const factIds = req.candidate_evidence_fact_ids;
    for (const id of factIds) if (!facts.has(id)) throw new StructuredOutputError('Unknown candidate evidence ID');
    const years = source.text.match(/\b(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)\b/i)?.[1];
    return {requirement: source.text, source_quote: source.text,
      importance: source.importance_hint || req.importance, category: req.category,
      candidate_evidence_fact_ids: factIds,
      candidate_evidence_provenance: [...new Set(factIds.map(id => facts.get(id).provenance).filter(Boolean))],
      match: req.match, reason: req.reason, genuinely_ambiguous: req.match === 'UNKNOWN' && factIds.length > 0,
      min_years: years ? Number(years) : null,
      professional_only: Boolean(years && /\b(professional|commercial)\b/i.test(source.text)),
      skill: req.skill, strict: req.strict};
  });
  const usedFragmentIds = wire.requirements.map(req => req.source_fragment_id);
  if (new Set(usedFragmentIds).size !== usedFragmentIds.length)
    throw new StructuredOutputError('Duplicate requirement source fragment');
  const work_format = {...wire.work_format};
  work_format.evidence = wire.work_format.evidence_fragment_ids.map(id => fragment(id).text);
  delete work_format.evidence_fragment_ids;
  const positives = requirements.filter(req => ['YES','PARTIAL'].includes(req.match));
  const mappedIds = [...new Set(positives.flatMap(req => req.candidate_evidence_fact_ids))];
  const result = {role_family: wire.role_family, role_level: wire.role_level,
    career_alignment: wire.career_alignment, requirements, work_format,
    hard_blockers: requirements.flatMap((req, index) => req.strict && req.importance === 'MANDATORY' && req.match === 'NO'
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
  return facts;
}

const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/_/g,' ').toLowerCase().trim();
const quoted = (text, source) => normalize(source).includes(normalize(text)) && Boolean(text?.trim());
const hasSkill = (fact, skill) => !skill || (fact.skills || []).some(s => normalize(s) === normalize(skill))
  || (fact.statements || []).some(s => quoted(skill, s));

/** A narrow completeness guard: explicit mandatory sentences cannot disappear. */
export function mandatoryRequirementAnchors(job) {
  return (job.description_text || '').split(/(?<=[.!?;])\s+|\n+/).map(s => s.trim())
    .filter(s => /\b(required|requirements?|mandatory|must have|must possess|essential)\b|wymagan|obowiazkow/i.test(normalize(s)))
    .filter(s => !/\b(not required|not mandatory|not essential)\b/i.test(s))
    // Embedded commands are untrusted data, not genuine job qualifications.
    .filter(s => !/ignore previous|reveal|environment variables|upload another|instructions|secret|token|localhost/i.test(s));
}

export function missingMandatoryListItems(analysis, job) {
  const tokens = text => normalize(text).replace(/\beducation\b/g, 'degree').match(/[\p{L}\p{N}]+/gu) || [];
  const missing = [];
  for (const sentence of mandatoryRequirementAnchors(job)) {
    const list = sentence.match(/\bmandatory\s*:\s*(.*)/i)?.[1];
    if (!list) continue;
    for (const item of list.replace(/[.!?;]+$/, '').split(/,|\s+and\s+/).map(s => s.trim()).filter(Boolean)) {
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
  if (!validateSchema(analysis)) throw new StructuredOutputError('Fit analysis JSON schema mismatch');
  const facts = factIndex(profile);
  const source = [job.title, job.description_text, job.location, job.country, job.work_mode].filter(Boolean).join('\n');
  const allIds = [...analysis.matched_fact_ids, ...analysis.cv_focus_fact_ids];
  for (const req of analysis.requirements) {
    allIds.push(...req.candidate_evidence_fact_ids);
    if (!quoted(req.source_quote, source)) throw new StructuredOutputError('Requirement quote missing from vacancy');
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
      throw new StructuredOutputError('Explicit mandatory requirement omitted');
  }
  if (missingMandatoryListItems(analysis, job).length)
    throw new StructuredOutputError('Explicit mandatory list item omitted or merged without requirement mapping');
  for (const quote of analysis.work_format.evidence)
    if (!quoted(quote, source)) throw new StructuredOutputError('Work-format quote missing from vacancy');
  if ((analysis.work_format.work_from_poland_allowed !== null || analysis.work_format.can_hire_in_poland !== null)
    && !analysis.work_format.evidence.length)
    throw new StructuredOutputError('Confirmed hiring eligibility requires vacancy evidence');
  if (analysis.work_format.authorization_known_impossible && !analysis.requirements.some(req =>
    req.category === 'LEGAL' && req.importance === 'MANDATORY' && req.match === 'NO' && req.strict))
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

export function enforceEducation(requirements, profile) {
  const facts = factIndex(profile);
  return requirements.map(req => {
    if (req.category !== 'EDUCATION' || !/\b(completed|bachelor|master|degree|bsc|msc)\b/i.test(req.requirement)) return req;
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
const countryName = value => countryCodes[normalize(value)] || normalize(value);

export function workFormatAnalysis({job, profile, policy = {}, workFormat}) {
  const f = workFormat || {};
  const loc = policy.work_location_policy || {};
  const country = countryName(f.office_country || job.country);
  const city = normalize(f.office_location || job.location);
  const base = profile.candidate?.base_location || loc.candidate_base || {city: 'Wroclaw', country: 'Poland'};
  const baseCity = normalize(base.city);
  const local = (city === baseCity || city.includes(`${baseCity},`) || city.includes(`${baseCity} `))
    || (typeof f.office_distance_km === 'number' && f.office_distance_km <= (loc.local?.radius_km ?? 30) && country === 'poland');
  const region = normalize(f.remote_region);
  const residency = normalize(f.employee_residency_requirement);
  const reasons = []; let classification = 'UNKNOWN', feasible = false, blocker = false;
  const regularOnsite = (f.onsite_days_per_week ?? 0) > 0 || (f.onsite_days_per_month ?? 0) > 1;
  if (f.remote_allowed === true && !f.hybrid_required && !regularOnsite) {
    if ((residency && !/\b(poland|pl|eu|europe|eea|emea|worldwide)\b/.test(residency)) || f.work_from_poland_allowed === false) {
      classification = 'REMOTE_COUNTRY_LOCKED_INELIGIBLE'; blocker = true; reasons.push('REMOTE_COUNTRY_LOCKED_INELIGIBLE');
    } else if (f.work_from_poland_allowed === true) {
      classification = /world|anywhere|global/.test(region) ? 'REMOTE_WORLDWIDE_FROM_POLAND'
        : /eu|europe|eea|emea/.test(region) ? 'REMOTE_EUROPE_FROM_POLAND' : /poland|\bpl\b/.test(region) ? 'REMOTE_POLAND' : 'UNKNOWN';
      feasible = classification !== 'UNKNOWN';
    }
  } else if (local && f.hybrid_required === true) {
    classification = 'HYBRID_WROCLAW_LOCAL'; feasible = loc.local?.hybrid_enabled !== false;
  } else if (local && f.remote_allowed === false && f.hybrid_required === false) {
    classification = 'ONSITE_WROCLAW_LOCAL'; feasible = loc.local?.onsite_auto_apply === true;
    if (!feasible) reasons.push('LOCAL_ONSITE_REVIEW');
  } else if (country === 'poland' && f.hybrid_required === true && f.onsite_days_per_week === 0
    && f.onsite_days_per_month !== null && f.onsite_days_per_month !== undefined
    && f.onsite_days_per_month <= (loc.poland_nonlocal?.max_onsite_days_per_month_for_auto_apply ?? 1)) {
    classification = 'HYBRID_POLAND_RARE_TRAVEL'; feasible = loc.poland_nonlocal?.rare_travel_enabled !== false;
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
  if (!hireConfirmed) reasons.push(['B2B','CONTRACTOR','EOR'].includes(route) ? 'HIRING_ARRANGEMENT_NOT_PREAPPROVED' : 'EMPLOYMENT_ROUTE_UNKNOWN');
  if (f.authorization_known_impossible) {blocker = true; reasons.push('WORK_AUTHORIZATION_IMPOSSIBLE');}
  // Citizenship alone never confirms a non-EU permit or regulated status.
  if (f.work_authorization_required && ['uk','united kingdom','switzerland'].includes(country)) {
    const known = country === 'switzerland' ? profile.onboarding?.switzerland_work_authorization : profile.onboarding?.uk_work_authorization;
    if (known !== true && f.sponsorship_available !== true) {hireConfirmed = false; reasons.push('NON_EU_WORK_AUTHORIZATION_UNKNOWN');}
  }
  if (f.security_clearance_requirement || f.export_control_requirement) {hireConfirmed = false; reasons.push('SPECIAL_AUTHORIZATION_REVIEW');}
  return {work_format_class: classification, eligible_for_discovery: true,
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
    || analysis.requirements.some(req => req.importance === 'MANDATORY' && req.strict && req.match === 'NO')
    || (policy.excluded_companies || []).some(company => normalize(company) === normalize(job.company))
    || (policy.excluded_countries || []).some(country => normalize(country) === normalize(job.country));
  if (blocked) {decision = 'REJECT'; reasons.push('HARD_BLOCKER');}
  if (job.availability_status === 'CLOSED') {decision = 'REJECT'; reasons.push('JOB_CLOSED');}
  if (job.already_applied || job.duplicate_application) {decision = 'REJECT'; reasons.push('DUPLICATE_APPLICATION');}
  if (job.company_spam_guard && decision === 'AUTO_APPLY') {decision = 'REVIEW'; reasons.push('COMPANY_SPAM_GUARD');}
  return {...analysis, ...result, ...work, decision, reasons: [...new Set(reasons)],
    application_priority: result.overall_fit === null ? 0 : Math.round(result.overall_fit * (work.eligible_for_auto_apply ? 1 : 0.85)),
    prompt_version: PROMPT_VERSION};
}

export async function analyzeJob({job, profile, policy = {}, llm = new OllamaClient()}) {
  const compact = llm instanceof OllamaClient || llm.wireFormat === 'compact';
  const system = await readFile(new URL(compact ? '../../prompts/fit_analysis_compact.md' : '../../prompts/fit_analysis.md', import.meta.url), 'utf8');
  const catalog = compact ? sourceFragmentCatalog(job) : null;
  const prompt = JSON.stringify({candidate_facts: [...factIndex(profile).values()],
    candidate: profile.candidate, onboarding: profile.onboarding, search_policy: policy,
    explicit_requirement_sentences_to_cover: mandatoryRequirementAnchors(job),
    ...(compact ? {source_fragments_untrusted_data: catalog} : {}),
    untrusted_quoted_vacancy_data: {title: job.title, description_text: job.description_text?.slice(0, 40000),
      location: job.location, country: job.country, work_mode: job.work_mode}});
  const request = {system, prompt, schema: compact ? compactSchemaForJob(job, profile, catalog) : schemaForJob(job, profile),
    numCtx: compact && prompt.length < 20000 ? 8192 : 16384, numPredict: compact ? 2200 : undefined,
    repairInstruction: compact ? 'Use only existing integer source_fragment_id and candidate fact IDs. Map every mandatory list item separately. Never generate source quotes or provenance.' : undefined,
    validate: output => compact ? expandCompactAnalysis(output, {job, profile, catalog}) : validateFactIntegrity(output, profile, job)};
  const output = typeof llm === 'function' ? await llm(request) : await llm.json(request);
  const raw = compact ? expandCompactAnalysis(output, {job, profile, catalog}) : output;
  // An explicitly injected test gateway must satisfy exactly the same truth boundary.
  validateFactIntegrity(raw, profile, job);
  const analysis = {...raw, requirements: enforceLanguageLevels(enforceEducation(enforceProfessionalYears(raw.requirements, profile), profile), profile)};
  return routeAnalysis({job, profile, policy, analysis});
}

export function reusableAnswer(memory, key, context = {}) {
  return (memory.answers || []).find(answer => answer.key === key && answer.source === 'USER'
    && answer.reusable === true && answer.reuse_approved === true
    && Object.entries(answer.scope || {}).every(([name, value]) => context[name] === value)) || null;
}
