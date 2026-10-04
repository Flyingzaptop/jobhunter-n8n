import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import YAML from 'yaml';
import { safeFetch, parseSourcePayload, sourceEndpoint, extractJobPostings, decodeEntities } from './discovery.mjs';
import { normalizeRaw, duplicateConfidence, descriptionContent } from './normalization.mjs';
import {probeHeadlessBoards} from './headless-public-boards.mjs';
import {publishedNextPage,htmlPaginationLinks,listingCursor} from './discovery-cursors.mjs';
import {nextDetailState} from './board-document.mjs';
const publicHtmlAdapters = new Set(['teamtailor_public_html', 'workday_public_html', 'public_listing_html']);

export function publicListingJobUrls(source, text) {
  if (!source.job_link_pattern) throw new Error('PUBLIC_LISTING_JOB_PATTERN_REQUIRED');
  const pattern = new RegExp(source.job_link_pattern);
  const pagePattern=source.listing_page_pattern?new RegExp(source.listing_page_pattern):null;
  const urls = new Set();
  for (const [, href] of String(text).matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(decodeEntities(href), source.url);
      const sameOrigin=url.origin===new URL(source.url).origin;
      const regional=source.regional_listing_hosts?.includes(url.hostname)&&url.protocol==='https:';
      if ((!sameOrigin&&!regional) || !pattern.test(url.pathname)) continue;
      if(pagePattern?.test(url.pathname+url.search))continue;
      url.hash = ''; url.search = ''; urls.add(url.href);
    } catch { /* Invalid page links are not vacancy URLs. */ }
  }
  return [...urls];
}
const validateRobotsPayload = text => {
  if (/^\s*(?:<!doctype|<html|<head)/i.test(text) || !/(?:user-agent|sitemap|allow|disallow)\s*:/i.test(text))
    throw new Error('INVALID_ROBOTS_PAYLOAD');
  return text;
};

export const MARKET_REGISTRY = 'config/market_sources.yaml';
export async function loadMarketSources(registryPath = MARKET_REGISTRY) {
  const registry = YAML.parse(await readFile(registryPath, 'utf8'));
  const names = new Set();
  return registry.sources.map(source => {
    if (!source.name || names.has(source.name)) throw new Error('INVALID_MARKET_SOURCE_ID');
    names.add(source.name);
    if (source.profile !== 'real') throw new Error('REAL_MARKET_SOURCES_ONLY');
    return { timeout_ms: 12000, rate_limit_ms: 1500, max_response_bytes: 15000000,
      max_pages: 1, ...registry.defaults, ...source, source_id: source.name };
  });
}

// Specific UA groups override wildcard groups. Longest matching rule wins; Allow
// wins equal lengths. Never pretend to be Googlebot to acquire a different policy.
export function robotsAllows(text, input, userAgent = 'JobHunter') {
  const groups = []; let current = null; let sawRule = false;
  for (const line of String(text).split(/\r?\n/)) {
    const entry = line.replace(/#.*$/, '').trim().match(/^([^:]+):\s*(.*)$/);
    if (!entry) continue;
    const key = entry[1].toLowerCase(); const value = entry[2].trim();
    if (key === 'user-agent') {
      if (!current || sawRule) { current = { agents: [], rules: [] }; groups.push(current); sawRule = false; }
      current.agents.push(value.toLowerCase());
    } else if (current && ['allow', 'disallow'].includes(key)) {
      current.rules.push({ allow: key === 'allow', pattern: value }); sawRule = true;
    }
  }
  const ua = userAgent.toLowerCase();
  let selected = groups.filter(group => group.agents.some(agent => agent !== '*' && ua.includes(agent)));
  if (!selected.length) selected = groups.filter(group => group.agents.includes('*'));
  const url = new URL(input); const path = url.pathname + url.search;
  const matching = selected.flatMap(group => group.rules).filter(rule => rule.pattern).filter(rule => {
    const anchored = rule.pattern.endsWith('$');
    const pattern = (anchored ? rule.pattern.slice(0, -1) : rule.pattern)
      .split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path);
  }).sort((a, b) => b.pattern.length - a.pattern.length || Number(b.allow) - Number(a.allow));
  return matching[0]?.allow ?? true;
}

export function marketEndpoint(source) {
  if (source.adapter === 'smartrecruiters') return `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.board)}/postings?limit=100&offset=0`;
  return sourceEndpoint(source);
}
export function smartRecruitersPosting(item, source) {
  const sections = Object.values(item.jobAd?.sections ?? {});
  const description = sections.map(section => [section.title, section.text].filter(Boolean).join('\n')).filter(Boolean).join('\n');
  return { ...item, title: item.name, company: item.company?.name ?? source.company,
    location: [item.location?.city, item.location?.region, item.location?.country].filter(Boolean).join(', '),
    country: item.location?.country, url: `https://jobs.smartrecruiters.com/${encodeURIComponent(source.board)}/${encodeURIComponent(item.id)}`,
    applyUrl: item.applyUrl, published_at: item.releasedDate,
    status: item.active === false || /^(closed|expired)$/i.test(item.status ?? '') ? 'CLOSED' : 'OPEN', description,
    description_status: description ? 'OFFICIAL_DETAIL_FETCHED' : 'DETAIL_NOT_FETCHED' };
}
const iso = value => {
  if (typeof value === 'number') return new Date(value > 1e12 ? value : value * 1000).toISOString();
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
};
export function extractExplicitApplicationDeadlines(input='') {
  const months={january:1,jan:1,stycznia:1,januar:1,february:2,feb:2,lutego:2,februar:2,march:3,mar:3,marca:3,marz:3,maerz:3,
    april:4,apr:4,kwietnia:4,may:5,maja:5,mai:5,june:6,jun:6,czerwca:6,juni:6,july:7,jul:7,lipca:7,juli:7,
    august:8,aug:8,sierpnia:8,september:9,sep:9,sept:9,wrzesnia:9,october:10,oct:10,pazdziernika:10,oktober:10,
    november:11,nov:11,listopada:11,december:12,dec:12,grudnia:12,dezember:12};
  const output=[];
  for(const text of descriptionContent(input).split('\n')) {
    if(!/^(?:application deadline|closing date|deadline for applications|apply by|termin (?:skladania|składania) (?:aplikacji|zgloszen|zgłoszeń)|bewerbungsfrist|bewerbungsschluss)\s*:/i.test(text))continue;
    const value=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();let day,month,year;
    let match=value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if(match){[,year,month,day]=match;}
    else if((match=value.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/))){[,day,month,year]=match;}
    else if((match=value.match(/\b(\d{1,2})(?:st|nd|rd|th|\.)?\s+([a-z]+)\.?\s*,?\s*(\d{4})\b/))){day=match[1];month=months[match[2]];year=match[3];}
    else if((match=value.match(/\b([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})\b/))){month=months[match[1]];day=match[2];year=match[3];}
    if(!day||!month||!year||Number(year)<2000||Number(year)>2200)continue;
    const parsed=new Date(Date.UTC(Number(year),Number(month)-1,Number(day)));
    if(parsed.getUTCFullYear()!==Number(year)||parsed.getUTCMonth()!==Number(month)-1||parsed.getUTCDate()!==Number(day))continue;
    output.push({source_quote:text,deadline_date:parsed.toISOString().slice(0,10),
      past_after_utc:new Date(parsed.getTime()+2*86400000-1).toISOString(),timezone:'UNKNOWN_CONSERVATIVE_DATE_GRACE'});
  }
  return output;
}
export function officialDeadlineConflict(raw,{now=new Date()}={}) {
  const item=raw.raw_payload??{};const text=[item.descriptionPlain,item.description_text,item.descriptionHtml,item.description,item.content,
    ...(item.lists??[]).map(list=>list.content)].filter(Boolean).map(descriptionContent).join('\n');
  const deadlines=extractExplicitApplicationDeadlines(text);const past=deadlines.filter(deadline=>Date.parse(deadline.past_after_utc)<new Date(now).getTime());
  return past.length?{status:'UNKNOWN',reason:'AVAILABILITY_CONFLICT',method:'OFFICIAL_FEED_LISTED_WITH_EXPLICIT_PAST_APPLICATION_DEADLINE',
    deadlines:past,official_feed_listed:true}:null;
}
const list = value => Array.isArray(value) ? value : value ? [value] : [];
const canonicalSnapshot = job => {
  const { metadata, ...columns } = job;
  const snapshot = { ...(metadata ?? {}), ...columns };
  delete snapshot.metadata;
  return snapshot;
};
const xmlTag = (xml, name) => decodeEntities((xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] ?? '').replace(/^<!\[CDATA\[|\]\]>$/g, ''));

export function parseMarketPayload(source, text, fetchedUrl = marketEndpoint(source)) {
  if (publicHtmlAdapters.has(source.adapter)) return parseMarketPayload({ ...source, adapter: 'html' }, text, fetchedUrl)
    .map(raw => ({ ...raw, adapter: source.adapter }));
  if (['greenhouse', 'lever', 'ashby', 'html', 'rss'].includes(source.adapter)) {
    if (source.adapter === 'html') text = { jobs: extractJobPostings(text).map(item => ({ ...item, url: item.url ?? fetchedUrl })) };
    const parsed = parseSourcePayload(source.adapter === 'html' ? { ...source, adapter: 'json' } : source, text, fetchedUrl);
    return parsed.filter(raw => raw.raw_payload.isListed !== false).map(raw => ({ ...raw, adapter: source.adapter }));
  }
  if (source.adapter === 'wwr_rss') {
    const items = [...String(text).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(([, xml]) => {
      const headline = xmlTag(xml, 'title'); const split = headline.indexOf(': ');
      return { id: xmlTag(xml, 'guid'), title: split >= 0 ? headline.slice(split + 2) : headline,
        company: split >= 0 ? headline.slice(0, split) : xmlTag(xml, 'dc:creator'), url: xmlTag(xml, 'link'),
        description: xmlTag(xml, 'description'), published_at: xmlTag(xml, 'pubDate'),
        location: xmlTag(xml, 'region'), work_mode: 'REMOTE' };
    });
    return parseSourcePayload({ ...source, adapter: 'json' }, { jobs: items }, fetchedUrl).map(raw => ({ ...raw, adapter: source.adapter }));
  }
  const data = typeof text === 'string' ? JSON.parse(text) : text;
  let items;
  switch (source.adapter) {
    case 'remoteok': items = data.filter(item => item.id).map(item => ({ ...item, title: item.position,
      applyUrl: item.apply_url, published_at: item.date, work_mode: 'REMOTE' })); break;
    case 'remotive': items = data.jobs.map(item => ({ ...item, company: item.company_name,
      location: item.candidate_required_location, published_at: item.publication_date, employment_type: item.job_type, work_mode: 'REMOTE' })); break;
    case 'himalayas': items = data.jobs.map(item => ({ ...item, id: item.guid, company: item.companyName,
      url: typeof item.guid === 'string' && item.guid.startsWith('https:') ? item.guid : item.applicationLink,
      applyUrl: item.applicationLink, location: list(item.locationRestrictions).join(', ') || 'Worldwide',
      published_at: iso(item.pubDate), valid_through: iso(item.expiryDate), work_mode: 'REMOTE' })); break;
    case 'arbeitnow': items = data.data.map(item => ({ ...item, id: item.slug, company: item.company_name,
      published_at: iso(item.created_at), work_mode: item.remote ? 'REMOTE' : 'UNKNOWN', employment_type: list(item.job_types).join(', ') })); break;
    case 'jobicy': items = data.jobs.map(item => ({ ...item, id: item.id, title: item.jobTitle, company: item.companyName,
      location: item.jobGeo, description: item.jobDescription, published_at: item.pubDate, work_mode: 'REMOTE',
      employment_type: list(item.jobType).join(', ') })); break;
    case 'jobgether': items = data.jobs.map(item => ({ ...item, published_at: item.postedAt,
      work_mode: /hybrid/i.test(item.remote) ? 'HYBRID' : /remote/i.test(item.remote) ? 'REMOTE' : 'UNKNOWN', employment_type: item.contractType })); break;
    case 'smartrecruiters': items = data.content.map(item => smartRecruitersPosting(item, source)); break;
    default: throw new Error(`UNSUPPORTED_MARKET_ADAPTER_${source.adapter}`);
  }
  return parseSourcePayload({ ...source, adapter: 'json' }, { jobs: items }, fetchedUrl).map(raw => ({ ...raw, adapter: source.adapter }));
}

export async function verifyPublicJobPosting({ source, url, fetchOptions = {}, listingText, robotsText }) {
  const robots = source.robots_url?validateRobotsPayload(robotsText ?? (await safeFetch(source.robots_url, source, fetchOptions)).text):null;
  if (robots&&(!robotsAllows(robots, url) || !robotsAllows(robots, source.url))) throw new Error('ROBOTS_ACCESS_BLOCKED');
  const listing = listingText ?? (await safeFetch(source.url, source, fetchOptions)).text;
  const expected = new URL(url); const listed = [...listing.matchAll(/href\s*=\s*["']([^"']+)["']/gi)]
    .some(([, href]) => { try { const found = new URL(decodeEntities(href), source.url); return found.origin === expected.origin && found.pathname === expected.pathname; } catch { return false; } });
  if (!listed) return { status: 'UNKNOWN', reason: 'POSTING_NOT_IN_CURRENT_PUBLIC_LISTING' };
  const response = await safeFetch(url, source, fetchOptions);
  const records = parseMarketPayload(source, response.text, response.url);
  const valid = records.filter(raw => {
    const normalized = normalizeRaw(raw);
    const found = new URL(normalized.canonical_url);
    return found.origin === expected.origin && found.pathname === expected.pathname && normalized.description_text.length >= 80;
  });
  if (valid.length !== 1) return { status: 'UNKNOWN', reason: 'EXACT_PUBLIC_JOBPOSTING_NOT_CONFIRMED' };
  const raw = valid[0]; const normalized = normalizeRaw(raw);
  if (normalized.availability_status === 'CLOSED') return { status: 'CLOSED', raw };
  raw.raw_payload.status = 'OPEN';
  const conflict=officialDeadlineConflict(raw);if(conflict)return{...conflict,raw:null};
  return { status: 'OPEN', raw, method: 'OFFICIAL_PUBLIC_LISTING_AND_JOBPOSTING_GET' };
}

export function verifyPublicBoardPayload({source,url,postings,now=new Date()}){
  if(!Array.isArray(postings)||postings.length!==1)return{status:'UNKNOWN',reason:'EXACT_PUBLIC_BOARD_JOBPOSTING_NOT_CONFIRMED'};
  let raw,normalized;try{
    [raw]=parseSourcePayload({...source,adapter:'json'},{jobs:postings.map(item=>({...item,url:item.url??url}))},url);
    raw.adapter=source.adapter;normalized=normalizeRaw(raw);
  }catch{return{status:'UNKNOWN',reason:'PUBLIC_BOARD_IDENTITY_INCOMPLETE'};}
  const expected=new URL(url),actual=new URL(normalized.canonical_url);
  if(expected.origin!==actual.origin||expected.pathname!==actual.pathname||normalized.description_text.length<80)
    return{status:'UNKNOWN',reason:'PUBLIC_BOARD_POSTING_IDENTITY_MISMATCH'};
  const conflict=officialDeadlineConflict(raw,{now});if(conflict)return{...conflict,raw:null};
  const item=raw.raw_payload;const expiry=Date.parse(item.validThrough??item.application_deadline??'');
  let status='UNKNOWN',reason='PUBLIC_BOARD_EXPIRY_MISSING_OR_INVALID';
  if(item.closed===true||item.active===false||/^(?:closed|expired|inactive)$/i.test(item.status??'')){status='CLOSED';reason='PUBLIC_BOARD_EXPLICIT_CLOSED';}
  else if(Number.isFinite(expiry)){
    status=expiry>new Date(now).getTime()?'OPEN':'CLOSED';reason=status==='OPEN'?'PUBLIC_BOARD_CURRENT_DATED_POSTING':'PUBLIC_BOARD_EXPLICIT_EXPIRY';
    if(/^\d{4}-\d{2}-\d{2}$/.test(item.validThrough??'')&&(item.validThrough===new Date(now).toISOString().slice(0,10))){status='UNKNOWN';reason='PUBLIC_BOARD_DATE_ONLY_EXPIRY_TODAY_UNCERTAIN';}
    if(status==='CLOSED'&&/^(?:open|active)$/i.test(item.status??'')){status='UNKNOWN';reason='AVAILABILITY_CONFLICT';}
  }
  raw.raw_payload.status=status;
  return{status,reason,raw,method:'CURRENT_PUBLIC_BOARD_POSTING'};
}

export async function verifyPublicBoardPosting({source,url,fetchOptions={}}){
  if(source.adapter==='public_headless_jobposting'){
    let robots=null;if(source.robots_url)try{robots=validateRobotsPayload((await safeFetch(source.robots_url,source,fetchOptions)).text);}catch(error){if(!/SOURCE_HTTP_403|INVALID_ROBOTS_PAYLOAD/.test(error.message))throw error;}
    if(robots&&(!robotsAllows(robots,url)||!robotsAllows(robots,source.url)))throw new Error('ROBOTS_ACCESS_BLOCKED');
    const report=await probeHeadlessBoards({names:[source.board_key??source.name],maxDetails:1,exactJobUrl:url,allowUrl:input=>!robots||robotsAllows(robots,input)});
    const board=report.sources[0];const detail=board.details[0];
    if(detail?.http_status===404)return{status:'CLOSED',reason:'PUBLIC_BOARD_POSTING_NOT_FOUND',method:'PUBLIC_BOARD_POSTING_NOT_FOUND'};
    if(board.status!=='PUBLIC_PAGE_READABLE'||detail?.status!=='PUBLIC_DETAIL_READABLE')return{status:'UNKNOWN',reason:detail?.status??board.status};
    return verifyPublicBoardPayload({source,url,postings:detail.job_postings});
  }
  const robots=source.robots_url?validateRobotsPayload((await safeFetch(source.robots_url,source,fetchOptions)).text):null;
  if(robots&&!robotsAllows(robots,url))throw new Error('ROBOTS_ACCESS_BLOCKED');
  const response=await safeFetch(url,source,fetchOptions);
  return verifyPublicBoardPayload({source,url,postings:extractJobPostings(response.text)});
}

export function queryEvidence(job) {
  // Indexing hints only: zero evidence never excludes a vacancy from ingestion.
  const text = `${job.title}\n${job.description_text}`.toLowerCase();
  const expressions = {
    MECHANICAL_RD: /mechanical|konstruktor|mechanik|\bcad\b|\bcae\b|\bfea\b|\bcfd\b|simulation|symulac|aerospace|automotive|product development|research|r&d|validation/,
    AUTOMATION_ROBOTICS: /robot|automation|automaty|\bplc\b|mechatron|embedded|controls engineer|sterowan/,
    PYTHON_ML_DATA: /python|machine learning|\bml\b|data scien|scientific software|uczeni[ae] maszyn/,
    CROSS_DISCIPLINARY: /digital engineer|engineering software|graphics|gpu|computer vision|performance engineer|robotics software|simulation software/,
    IT_SYSTEMS_SUPPORT: /it support|technical support|system[s]? admin|administrator|informatyk|deployment|active directory|wsparcie technicz/,
  };
  return Object.entries(expressions).filter(([, regex]) => regex.test(text)).map(([family]) => family);
}

function normalizationIndex(jobs) {
  const urls = new Map(); const ats = new Map(); const identities = new Map();
  const index = job => {
    urls.set(job.canonical_url, job);
    if (job.ats_identity) ats.set(job.ats_identity, job);
    if (!identities.has(job.identity_key)) identities.set(job.identity_key, new Map());
    identities.get(job.identity_key).set(job.job_id, job);
  };
  jobs.forEach(index);
  return { index, candidates: job => [...new Set([urls.get(job.canonical_url), job.ats_identity && ats.get(job.ats_identity),
    ...[...(identities.get(job.identity_key)?.values() ?? [])]])].filter(Boolean) };
}
export async function createDiscoveryNormalizationState(repository){
 const jobs=repository.listNormalizationJobs?await repository.listNormalizationJobs():await repository.listCanonicalJobs();
 const state=normalizationIndex(jobs);let pending=Promise.resolve();
 state.serialize=operation=>{const result=pending.then(operation);pending=result.catch(()=>{});return result;};
 return state;
}

export async function saveSourceHealth(repository, runId, source, metrics) {
  if (!repository.pool) return;
  const operational = ['OPERATIONAL', 'OPERATIONAL_PARTIAL'].includes(metrics.status);
  const failed = metrics.status === 'FAILED' || metrics.status === 'ACCESS_BLOCKED';
  await repository.pool.query(`INSERT INTO market_source_runs(source_run_id,run_id,source_id,platform,adapter,status,started_at,completed_at,latency_ms,raw_count,unique_count,new_count,duplicate_count,error_code,metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8,$9,$10,$11,$12,$13,$14)`,
    [randomUUID(), runId, source.name, source.platform, source.adapter, metrics.status, metrics.started_at, metrics.latency_ms,
      metrics.raw_count, metrics.unique_count, metrics.new_count, metrics.duplicate_count, metrics.error_code ?? null, metrics]);
  await repository.pool.query(`INSERT INTO market_source_health(source_id,platform,adapter,status,last_run_at,last_success_at,last_failure_at,total_runs,total_failures,jobs_returned,unique_jobs,latency_ms,error_code,metadata)
    VALUES($1,$2,$3,$4,now(),CASE WHEN $5 THEN now() END,CASE WHEN $6 THEN now() END,1,CASE WHEN $6 THEN 1 ELSE 0 END,$7,$8,$9,$10,$11)
    ON CONFLICT(source_id) DO UPDATE SET status=EXCLUDED.status,last_run_at=now(),last_success_at=COALESCE(EXCLUDED.last_success_at,market_source_health.last_success_at),
    last_failure_at=COALESCE(EXCLUDED.last_failure_at,market_source_health.last_failure_at),total_runs=market_source_health.total_runs+1,
    total_failures=market_source_health.total_failures+EXCLUDED.total_failures,jobs_returned=CASE WHEN $5 THEN EXCLUDED.jobs_returned ELSE market_source_health.jobs_returned END,
    unique_jobs=CASE WHEN $5 THEN EXCLUDED.unique_jobs ELSE market_source_health.unique_jobs END,latency_ms=EXCLUDED.latency_ms,error_code=EXCLUDED.error_code,
    metadata=market_source_health.metadata || EXCLUDED.metadata`,
    [source.name, source.platform, source.adapter, metrics.status, operational, failed, metrics.raw_count, metrics.unique_count, metrics.latency_ms, metrics.error_code ?? null, metrics]);
}

export async function listMarketSourceHealth(repository, registryPath = MARKET_REGISTRY) {
  const sources = await loadMarketSources(registryPath);
  const health = repository.pool ? (await repository.pool.query(`WITH latest_analysis AS (
      SELECT DISTINCT ON(job_id) job_id,decision FROM job_analysis ORDER BY job_id,created_at DESC
    ), fit_counts AS (
      SELECT js.source_name,count(DISTINCT js.job_id) AS total_source_jobs,
        count(DISTINCT a.job_id) AS analyzed_jobs,
        count(DISTINCT a.job_id) FILTER(WHERE a.decision IN('AUTO_APPLY','REVIEW','STRETCH')) AS matched_jobs
      FROM job_sources js LEFT JOIN latest_analysis a ON a.job_id=js.job_id GROUP BY js.source_name
    ), daily AS (
      SELECT source_id,sum(raw_count)::integer AS jobs_seen_today,sum(new_count)::integer AS new_jobs_today
      FROM market_source_runs WHERE started_at >= date_trunc('day',now()) GROUP BY source_id
    ) SELECT h.*,h.total_failures::float/NULLIF(h.total_runs,0) AS error_rate,
      COALESCE(f.total_source_jobs,0)::integer AS total_source_jobs,COALESCE(f.analyzed_jobs,0)::integer AS analyzed_jobs,
      CASE WHEN f.analyzed_jobs>0 THEN f.matched_jobs::integer ELSE NULL END AS relevant_jobs,
      COALESCE(d.jobs_seen_today,0) AS jobs_seen_today,COALESCE(d.new_jobs_today,0) AS new_jobs_today
    FROM market_source_health h LEFT JOIN fit_counts f ON f.source_name=h.source_id LEFT JOIN daily d ON d.source_id=h.source_id`)).rows : [];
  const byName = new Map(health.map(item => [item.source_id, item]));
  return sources.map(source => ({ ...source, configured_enabled: source.enabled, ...byName.get(source.name),
    status: byName.get(source.name)?.status ?? (source.enabled === false ? source.discovery_capability : 'NOT_SCANNED'),
    catalog_state: byName.get(source.name)?.last_success_at ? 'LIVE_VERIFIED' : source.catalog_state,
    last_request_at: byName.get(source.name)?.metadata?.last_request_at ?? null,
    next_request_at: byName.get(source.name)?.metadata?.next_request_at ?? null,
    rate_limit_state: Date.parse(byName.get(source.name)?.metadata?.next_request_at) > Date.now() ? 'COOLDOWN' : 'READY',
    authenticated: false, observed_operational: Boolean(byName.get(source.name)?.last_success_at) }));
}

export async function runMarketDiscovery(options={}){
  if(!options.repository?.pool?.connect)return performMarketDiscovery(options);
  const lock=await options.repository.pool.connect();let acquired=false,shared=false,sourceKey;
  try{
    if(options.parallelSource){
      if(options.sourceIds?.length!==1)throw new Error('EXACT_SINGLE_SOURCE_REQUIRED');
      shared=(await lock.query("SELECT pg_try_advisory_lock_shared(hashtext('jobhunter.market-discovery')) AS locked")).rows[0].locked;
      if(!shared)throw new Error('DISCOVERY_ALREADY_RUNNING');
      sourceKey='jobhunter.market-discovery.source.'+options.sourceIds[0];
      acquired=(await lock.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',[sourceKey])).rows[0].locked;
    }else acquired=(await lock.query("SELECT pg_try_advisory_lock(hashtext('jobhunter.market-discovery')) AS locked")).rows[0].locked;
    if(!acquired)throw new Error('DISCOVERY_ALREADY_RUNNING');
    return await performMarketDiscovery(options);
  }finally{if(acquired){if(sourceKey)await lock.query('SELECT pg_advisory_unlock(hashtext($1))',[sourceKey]);else await lock.query("SELECT pg_advisory_unlock(hashtext('jobhunter.market-discovery'))");}if(shared)await lock.query("SELECT pg_advisory_unlock_shared(hashtext('jobhunter.market-discovery'))");lock.release();}
}
async function performMarketDiscovery({ repository, observer = async () => {}, registryPath = MARKET_REGISTRY,
  sourceIds, maxSources, signal, fetchOptions = {},continuousPolling=false,normalizationState } = {}) {
  if (!repository) throw new Error('POSTGRES_REPOSITORY_REQUIRED');
  const catalog = await loadMarketSources(registryPath);
  let sources = catalog;
  if (sourceIds) {
    const requested = new Set(sourceIds);
    if ([...requested].some(id => !sources.some(source => source.name === id))) throw new Error('UNKNOWN_MARKET_SOURCE');
    sources = sources.filter(source => requested.has(source.name));
  }
  if (maxSources !== undefined) {
    if (!Number.isInteger(maxSources) || maxSources < 1) throw new Error('INVALID_MAX_SOURCES');
    sources = sources.slice(0, maxSources);
  }
  const runId = randomUUID(); const started = new Date().toISOString();
  if (repository.pool) await repository.pool.query('INSERT INTO market_discovery_runs(run_id,started_at) VALUES($1,$2)', [runId, started]);
  const existing = normalizationState??await createDiscoveryNormalizationState(repository);
  const seen = new Set(); const newIds = new Set(); const jobs = new Map(); const results = [];
  const emit = async (source, details) => observer({ run_id: runId, source_id: source?.name, platform: source?.platform,
    query: source?.current_query ?? (publicHtmlAdapters.has(source?.adapter) ? 'Bounded public listing and JobPosting details'
      : source?.source_class === 'employer_ats' ? 'All published employer vacancies' : 'Broad public market feed'),
    geography: source?.current_geography ?? (source?.source_class === 'poland_board' ? 'Poland' : 'Global / Europe / Poland; eligibility unverified'), ...details });
  const checkAbort = () => { if (signal?.aborted) throw new Error('DISCOVERY_CANCELLED'); };
  let cancelled = false;
  for (const source of sources) {
    if (signal?.aborted) { cancelled = true; break; }
    const t = performance.now(); const metrics = { source_id: source.name, platform: source.platform, adapter: source.adapter,
      source_class: source.source_class, company: source.company ?? null, started_at: new Date().toISOString(),
      raw_count: 0, unique_count: 0, new_count: 0, duplicate_count: 0, status: 'RUNNING',
      pages: 0, normalization_errors: [], samples: [], query_evidence_count: 0 };
    const sourceUnique = new Set(); let sourceNew = 0;
    const prior = repository.pool ? (await repository.pool.query('SELECT * FROM market_source_health WHERE source_id=$1', [source.name])).rows[0] : null;
    const sourceInterval=source.adapter==='policy_probe'?(source.min_scan_interval_ms??3600000):
      prior?.metadata?.truncated?(source.continuation_scan_interval_ms??source.min_scan_interval_ms??0):(source.min_scan_interval_ms??0);
    const failedPrior=['FAILED','ACCESS_BLOCKED'].includes(prior?.status);
    const listingRootChanged=['public_listing_html','public_headless_jobposting'].includes(source.adapter)&&prior?.metadata?.listing_root_url!==source.url;
    const cooldownAnchor=listingRootChanged?null:source.adapter==='policy_probe'||failedPrior?prior?.last_run_at:prior?.last_success_at;
    const interval=failedPrior?(source.failure_backoff_ms??3600000):sourceInterval;
    const storedDueAt=Date.parse(prior?.metadata?.next_request_at??'');
    const calculatedDueAt=cooldownAnchor?new Date(cooldownAnchor).getTime()+interval:0;
    const dueAt=listingRootChanged?0:Number.isFinite(storedDueAt)?storedDueAt:calculatedDueAt;
    try {
      await emit(source, { event: 'source_started', status: 'RUNNING', cursor: results.length + 1,
        message: source.source_class === 'employer_ats' ? `${source.platform} board scan — ${source.company} — source ${results.length + 1}/${sources.length}` : `Searching ${source.platform}` });
      if (source.enabled === false) {
        metrics.status = source.discovery_capability ?? 'DISABLED'; metrics.error_code = 'SOURCE_DISABLED'; metrics.reason = source.reason;
      } else if(Date.now()<dueAt){
        metrics.status='RATE_LIMIT_WAIT';metrics.next_request_at=new Date(dueAt).toISOString();
      } else if (source.adapter === 'policy_probe') {
        // Attempt policy only. Forbidden APIs/search pages are never probed.
        metrics.last_request_at = new Date().toISOString();
        const response = await safeFetch(source.url, source, fetchOptions);
        metrics.pages++; metrics.status = source.discovery_capability; metrics.reason = source.reason;
        metrics.access_evidence = { checked_at: new Date().toISOString(), policy_url: response.url,
          policy_status: response.status, search_allowed_by_robots: source.search_url ? robotsAllows(response.text, source.search_url) : null,
          robots_excerpt: response.text.slice(0, 1600) };
      } else if (source.permitted_access !== true) {
        metrics.status = 'MANUAL_DISCOVERY_FALLBACK'; metrics.error_code = 'ACCESS_NOT_CONFIGURED_AS_PERMITTED';
      } else {
        let robots = null;
        if (source.robots_url) {
          metrics.policy_attempted = true; metrics.last_request_at = new Date().toISOString();
          try {
            const policyResponse = await safeFetch(source.robots_url, source, fetchOptions);
            metrics.policy_requests = 1; robots = validateRobotsPayload(policyResponse.text);
            metrics.policy_status = 'PUBLIC_ROBOTS_READABLE'; metrics.policy_error_code = null;
          } catch (error) {
            if (source.adapter !== 'public_headless_jobposting' || !/SOURCE_HTTP_40[36]|INVALID_ROBOTS_PAYLOAD/.test(error.message)) throw error;
            metrics.policy_requests = 1; metrics.policy_status = 'UNKNOWN_PUBLIC_ROBOTS_UNAVAILABLE';
            metrics.policy_error_code = error.message;
          }
        }
        const read = async url => {
          checkAbort();
          if (robots && new URL(url).hostname === new URL(source.robots_url).hostname && !robotsAllows(robots, url)) throw new Error('ROBOTS_ACCESS_BLOCKED');
          metrics.last_request_at = new Date().toISOString();
          const response = await safeFetch(url, source, fetchOptions); metrics.pages++;
          return response;
        };
        const ingestUnsafe = async records => {
          for (const record of records) {
            checkAbort(); metrics.raw_count++;
            try {
              const raw = { ...record, ingestion_run_id: runId };
              const savedRaw = await repository.insertRaw(raw); raw.raw_id = savedRaw.raw_id;
              const job = normalizeRaw(raw); job.query_role_evidence = queryEvidence(job);
              if(source.search_keyword)job.discovery_query={keyword:source.search_keyword,source_id:source.name,search_url:source.url,scope:'KEYWORD_SEARCH',geography_filter:'CURRENT_USER_POLICY_AFTER_DISCOVERY'};
              const conflict=source.source_class==='employer_ats'&&job.availability_status==='OPEN'?officialDeadlineConflict(raw):null;
              if(conflict){job.availability_status='UNKNOWN';job.availability_conflict=conflict;}
              job.adapter = raw.adapter; job.source_board = raw.source_board;
              if (source.source_class === 'employer_ats' && job.availability_status === 'OPEN') {
                job.discovery_open_verification = { method: publicHtmlAdapters.has(source.adapter)
                  ? 'OFFICIAL_PUBLIC_LISTING_AND_JOBPOSTING_GET' : 'OFFICIAL_PUBLISHED_ATS_FEED_GET', source_id: source.name,
                  verified_at: new Date().toISOString() };
              }
              if (job.query_role_evidence.length) metrics.query_evidence_count++;
              const candidates = existing.candidates(job).map(candidate => ({ candidate, match: duplicateConfidence(job, candidate) })).filter(item => item.match);
              candidates.sort((a, b) => b.match.confidence - a.match.confidence);
              const duplicate = candidates[0];
              job.duplicate_signal = duplicate?.match ?? null;
              job.discovery_raw_id = raw.raw_id;
              if (duplicate) {
                job.job_id = duplicate.candidate.job_id; job.canonical_url = duplicate.candidate.canonical_url;
                job.ats_identity ??= duplicate.candidate.ats_identity;
                if (job.work_mode === 'UNKNOWN') job.work_mode = duplicate.candidate.work_mode;
                for (const field of ['country', 'employment_type', 'published_at', 'valid_through', 'salary']) job[field] ??= duplicate.candidate[field] ?? null;
                if (!job.description_text && duplicate.candidate.description_text) { job.description_text = duplicate.candidate.description_text; job.content_hash = duplicate.candidate.content_hash; }
                if (job.availability_status === 'UNKNOWN' && !job.availability_conflict && duplicate.candidate.availability_status === 'OPEN') job.availability_status = 'OPEN';
                if (!raw.raw_payload.applyUrl && !raw.raw_payload.application_url) job.application_url = duplicate.candidate.application_url;
              }
              const saved = await repository.upsertCanonicalJob(job, { source: raw, duplicate_signal: duplicate?.match ?? null });
              job.job_id = saved.job_id; existing.index(job); jobs.set(saved.job_id, job); sourceUnique.add(saved.job_id); seen.add(saved.job_id);
              if (saved.is_new) { newIds.add(saved.job_id); sourceNew++; }
              if (source.source_class === 'employer_ats' && job.availability_status === 'OPEN' && repository.pool) {
                await repository.pool.query('UPDATE jobs SET last_verified_open_at=now(),closed_at=NULL WHERE job_id=$1', [saved.job_id]);
              }
              if (metrics.samples.length < 3) metrics.samples.push({ job_id: saved.job_id, title: job.title, company: job.company, url: job.canonical_url });
            } catch (error) {
              if (error.message === 'DISCOVERY_CANCELLED') throw error;
              metrics.normalization_errors.push({ source_item_id: record.source_item_id, error: error.message });
            }
          }
          await emit(source, { event: 'source_progress', status: 'RUNNING', count: metrics.raw_count,
            cursor: metrics.pages, processed: metrics.raw_count, unique_count: sourceUnique.size,
            new_count: sourceNew, duplicates: Math.max(0, metrics.raw_count - sourceNew - metrics.normalization_errors.length),
            errors: metrics.normalization_errors.length,
            message: `${source.platform}: ${metrics.raw_count} vacancies, ${sourceNew} new, page ${metrics.pages}` });
        };
        const ingest=records=>existing.serialize?existing.serialize(()=>ingestUnsafe(records)):ingestUnsafe(records);
        if (source.adapter === 'public_headless_jobposting') {
          if (robots && !robotsAllows(robots,source.url)) throw new Error('ROBOTS_ACCESS_BLOCKED');
          const resume=prior?.metadata?.listing_root_url===source.url?prior.metadata:{};
          const currentUrl=resume.next_listing_page_url??source.url;
          if(robots&&!robotsAllows(robots,currentUrl))throw new Error('ROBOTS_ACCESS_BLOCKED');
          const retry=(resume.pending_details??[]).find(item=>Date.parse(item.next_retry_at)<=Date.now());
          const result = await probeHeadlessBoards({names:[source.board_key??source.name],maxDetails:retry?1:source.max_pages,
            detailOffset:retry?0:Number(resume.next_listing_offset??0),listingUrl:currentUrl,snapshotLinks:retry?undefined:resume.listing_page_snapshot,
            ...(retry?{exactJobUrl:retry.url}:{}),
            allowUrl:url=>!robots||robotsAllows(robots,url)});
          const board=result.sources[0]; metrics.headless=board.headless??true; metrics.gpu_disabled=true;metrics.access_mode=board.access_mode??'ISOLATED_PUBLIC_BROWSER';
          metrics.browser_status=board.status; metrics.listing_http_status=board.http_status;
          metrics.public_vacancy_links=board.job_link_count??0; metrics.listing_root_url=source.url;
          metrics.pages=1+board.details.length;
          if(board.status==='PUBLIC_POLICY_DENIED')throw new Error('ROBOTS_ACCESS_BLOCKED');
          if(['CHALLENGE_OR_CAPTCHA','HTTP_ACCESS_BLOCKED','PARTIAL_ACCESS_BLOCKED'].includes(board.status)) throw new Error('HEADLESS_PUBLIC_CHALLENGE');
          if(board.status!=='PUBLIC_PAGE_READABLE') throw new Error('HEADLESS_PUBLIC_LISTING_UNAVAILABLE');
          for(const detail of board.details) {
            if(robots&&!robotsAllows(robots,detail.url)) throw new Error('ROBOTS_ACCESS_BLOCKED');
            if(detail.status!=='PUBLIC_DETAIL_READABLE'||detail.structured_job_count!==1){metrics.normalization_errors.push({source_url:detail.url,error:detail.status});continue;}
            const records=parseSourcePayload({...source,adapter:'json'},{jobs:detail.job_postings.map(item=>({...item,url:item.url??detail.url}))},detail.url)
              .map(raw=>({...raw,adapter:source.adapter}));
            await ingest(records);
          }
          if(retry){for(const key of ['listing_page_url','listing_page_completed','cycle_completed','coverage_status','next_listing_page_url','next_listing_offset','truncated','listing_page_snapshot'])metrics[key]=resume[key];}
          else {Object.assign(metrics,listingCursor({rootUrl:source.url,currentUrl,nextUrl:board.published_next_page_url,
            total:board.job_link_count,offset:Number(resume.next_listing_offset??0),processed:board.details.length}));
            metrics.listing_page_snapshot=metrics.listing_page_completed?[]:board.job_links;}
          metrics.pending_details=nextDetailState(resume.pending_details,board.details);
          if(metrics.pending_details.length){metrics.cycle_completed=false;metrics.truncated=true;metrics.coverage_status='DETAIL_RETRIES_PENDING';}
          if(board.pagination_observation_failed){metrics.cycle_completed=false;metrics.truncated=true;metrics.coverage_status='PAGINATION_OBSERVATION_PENDING';}
          metrics.coverage_scope='PUBLISHED_PUBLIC_LISTING_PAGES_ONLY';
        } else if (publicHtmlAdapters.has(source.adapter)) {
          const resume=source.adapter==='public_listing_html'&&prior?.metadata?.listing_root_url===source.url?prior.metadata:{};
          const currentUrl=resume.next_listing_page_url??source.url;
          const listing = await read(currentUrl);
          metrics.listing_url = listing.url;
          const oldSnapshot=resume.listing_page_snapshot??[];
          const pagePattern=source.listing_page_pattern?new RegExp(source.listing_page_pattern):null;
          const actualVacancy=url=>!pagePattern?.test(new URL(url).pathname+new URL(url).search);
          const jobUrls = source.adapter === 'public_listing_html' ? (oldSnapshot.length?oldSnapshot.filter(actualVacancy):publicListingJobUrls(source, listing.text)) : source.job_urls;
          const oldOffset=Number(resume.next_listing_offset??0);
          const offset = source.adapter === 'public_listing_html' ? oldOffset-oldSnapshot.slice(0,oldOffset).filter(url=>!actualVacancy(url)).length : 0;
          const retryCounts=resume.listing_page_url===currentUrl?{...(resume.listing_retry_counts??{})}:{};
          if(source.adapter==='public_listing_html')for(const failure of resume.normalization_errors??[]){
            const index=jobUrls.indexOf(failure.source_url);
            if(index>=0&&index<offset&&(retryCounts[failure.source_url]??0)<2){jobUrls.push(failure.source_url);retryCounts[failure.source_url]=(retryCounts[failure.source_url]??0)+1;}
          }
          const bounded = jobUrls.slice(offset, offset + source.max_pages);
          metrics.bounded_job_urls = jobUrls.length;
          metrics.next_listing_offset = offset + bounded.length;
          metrics.truncated = offset + bounded.length < jobUrls.length;
          for (const url of bounded) {
            try {
              const verification = await verifyPublicJobPosting({ source, url, fetchOptions, listingText: listing.text, robotsText: robots });
              metrics.pages++; metrics.last_request_at = new Date().toISOString();
              if (!verification.raw) metrics.normalization_errors.push({ source_url: url, error: verification.reason });
              else await ingest([verification.raw]);
            } catch (error) {
              if (error.message === 'DISCOVERY_CANCELLED' || /ROBOTS|SOURCE_HTTP_40[1369]/.test(error.message)) throw error;
              metrics.normalization_errors.push({ source_url: url, error: error.message });
            }
          }
          if(source.adapter==='public_listing_html'){
            const nextUrl=publishedNextPage(htmlPaginationLinks(listing.text),currentUrl,{pagePattern:source.listing_page_pattern});
            Object.assign(metrics,listingCursor({rootUrl:source.url,currentUrl,nextUrl,total:jobUrls.length,offset,processed:bounded.length}));
            metrics.listing_root_url=source.url;metrics.listing_page_snapshot=metrics.listing_page_completed?[]:jobUrls;
            metrics.listing_retry_counts=metrics.listing_page_completed?{}:retryCounts;
            metrics.coverage_scope='PUBLISHED_PUBLIC_LISTING_PAGES_ONLY';
          }
        } else if (source.adapter === 'sitemap_html') {
          const queue = [source.url]; const urls = []; const visited = new Set();
          while (queue.length && visited.size < 12) {
            const url = queue.shift(); if (visited.has(url)) continue; visited.add(url);
            const page = await read(url);
            const locs = [...page.text.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map(([, loc]) => decodeEntities(loc.trim()));
            if (/<sitemapindex\b/i.test(page.text)) queue.push(...locs); else urls.push(...locs);
          }
          metrics.sitemap_vacancy_urls = urls.length;
          const offset = Number(prior?.metadata?.next_sitemap_offset ?? 0) % (urls.length || 1);
          const bounded = urls.slice(offset, offset + source.max_pages);
          for (const url of bounded) {
            try {
              const response = await read(url);
              await ingest(parseMarketPayload({ ...source, adapter: 'html' }, response.text, response.url));
            } catch (error) {
              if (error.message === 'DISCOVERY_CANCELLED' || /ROBOTS|SOURCE_HTTP_40[1369]/.test(error.message)) throw error;
              metrics.normalization_errors.push({ source_url: url, error: error.message });
            }
          }
          metrics.next_sitemap_offset = offset + bounded.length; metrics.truncated = offset + bounded.length < urls.length;
        } else {
          metrics.queries = [];
          metrics.feed_cursors={...(prior?.metadata?.feed_cursors??{})};
          for (const plan of source.query_plans ?? [{ query: 'All published vacancies', geography: 'Global / Europe / Poland', parameters: {} }]) {
            const initial = new URL(marketEndpoint(source));
            for (const [key, value] of Object.entries(plan.parameters ?? {})) initial.searchParams.set(key, String(value));
            source.current_query = plan.parameters?.keyword ?? plan.parameters?.q ?? plan.query; source.current_geography = plan.geography;
            await emit(source, { event: 'source_query_started', status: 'RUNNING', cursor: 1,
              message: `Searching ${source.platform} — ${plan.query} — ${plan.geography}` });
            const queryMetrics = { query: source.current_query, query_family: plan.query, geography: plan.geography, raw_count: 0, pages: 0 };
            metrics.queries.push(queryMetrics);
            const feedKey=initial.href;const feedCursor=metrics.feed_cursors[feedKey]??{};
            if(feedCursor.cycle_completed&&prior?.metadata?.cycle_completed===false){queryMetrics.completed_prior_cycle=true;continue;}
            let next = feedCursor.next_url??initial.href; let page = 0;let absolutePage=feedCursor.next_url?Number(feedCursor.pages_processed??0):0;
            let cycleRecords=feedCursor.next_url?Number(feedCursor.records_processed??0):0;
            const cycleStartedAt=feedCursor.next_url?feedCursor.cycle_started_at:new Date().toISOString();
            while (next && page < source.max_pages) {
              const previousCount = metrics.raw_count;
              const response = await read(next); await ingest(parseMarketPayload(source, response.text, response.url)); page++;absolutePage++;
              queryMetrics.raw_count += metrics.raw_count - previousCount; queryMetrics.pages++;
              cycleRecords+=metrics.raw_count-previousCount;
              const data = ['rss', 'wwr_rss'].includes(source.adapter) ? {} : JSON.parse(response.text);
              next = null;
              if (source.adapter === 'himalayas' && data.nextCursor) {
                const url = new URL(initial); url.searchParams.set('cursor', data.nextCursor); next = url.href;
              }
              if (source.adapter === 'arbeitnow' && data.links?.next) next = data.links.next;
              if (source.adapter === 'jobicy' && data.nextCursor) {
                const url = new URL(initial); url.searchParams.set('cursor', data.nextCursor); next = url.href;
              }
              if (source.adapter === 'jobgether' && data.pagination?.hasMore) {
                const url = new URL(initial); url.searchParams.set('page', String(absolutePage + 1)); url.searchParams.set('limit', '25'); next = url.href;
              }
              if (source.adapter === 'smartrecruiters' && Number(data.totalFound) > absolutePage * 100) {
                const url = new URL(marketEndpoint(source)); url.searchParams.set('offset', String(absolutePage * 100)); next = url.href;
              }
              queryMetrics.truncated = Boolean(next);
              metrics.truncated = metrics.truncated || Boolean(next);
              metrics.feed_cursors[feedKey]={next_url:next,pages_processed:absolutePage,records_processed:cycleRecords,
                cycle_started_at:cycleStartedAt,cycle_completed_at:next?null:new Date().toISOString(),cycle_completed:!next,last_page_url:response.url};
            }
          }
          metrics.cycle_completed=!metrics.truncated;
          metrics.coverage_status=metrics.cycle_completed?'OBSERVED_FEED_CYCLE_COMPLETE':'INCREMENTAL_SCAN_PENDING';
        }
        metrics.status = metrics.normalization_errors.length ? 'OPERATIONAL_PARTIAL' : 'OPERATIONAL';
      }
    } catch (error) {
      metrics.error_code = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'SOURCE_TRANSPORT_ERROR';
      if (error.message === 'DISCOVERY_CANCELLED') { metrics.status = 'CANCELLED'; cancelled = true; }
      else metrics.status = /SOURCE_HTTP_40[1369]|ROBOTS|HEADLESS_PUBLIC_CHALLENGE/.test(error.message) ? 'ACCESS_BLOCKED' : 'FAILED';
      if (error.message === 'INVALID_ROBOTS_PAYLOAD') { metrics.status = 'MANUAL_DISCOVERY_FALLBACK'; metrics.reason = 'Public robots endpoint did not return a usable policy; no protected/API fallback attempted.'; }
      // Failed access never triggers a stealth browser/alternate authenticated API.
    }
    metrics.latency_ms = Math.round(performance.now() - t); metrics.unique_count = sourceUnique.size;
    if (['OPERATIONAL', 'OPERATIONAL_PARTIAL'].includes(metrics.status)) metrics.next_request_at = source.min_scan_interval_ms
      ? new Date(Date.now() + (metrics.truncated?(source.continuation_scan_interval_ms??source.min_scan_interval_ms):source.min_scan_interval_ms)).toISOString() : null;
    if(continuousPolling&&['OPERATIONAL','OPERATIONAL_PARTIAL'].includes(metrics.status))
      metrics.next_request_at=new Date(Date.now()+(metrics.truncated?(source.continuation_scan_interval_ms??60000):3600000)).toISOString();
    else if(['FAILED','ACCESS_BLOCKED'].includes(metrics.status))metrics.next_request_at=new Date(Date.now()+(source.failure_backoff_ms??3600000)).toISOString();
    else if(source.adapter==='policy_probe'&&metrics.status!=='RATE_LIMIT_WAIT')metrics.next_request_at=new Date(Date.now()+(source.min_scan_interval_ms??3600000)).toISOString();
    metrics.new_count = sourceNew; metrics.duplicate_count = Math.max(0, metrics.raw_count - sourceNew - metrics.normalization_errors.length);
    await saveSourceHealth(repository, runId, source, metrics); results.push(metrics);
    await emit(source, { event: 'source_completed', status: metrics.status, count: metrics.raw_count,
      processed: metrics.raw_count, unique_count: metrics.unique_count, new_count: metrics.new_count,
      duplicates: metrics.duplicate_count, errors: metrics.normalization_errors.length + (metrics.error_code ? 1 : 0),
      latency_ms: metrics.latency_ms, error_code: metrics.error_code, message: `${source.platform}: ${metrics.status}, ${metrics.raw_count} vacancies` });
    if (cancelled) break;
  }
  const distribution = field => [...jobs.values()].reduce((counts, job) => { const value = job[field] ?? 'UNKNOWN'; counts[value] = (counts[value] ?? 0) + 1; return counts; }, {});
  const operational = results.filter(result => ['OPERATIONAL', 'OPERATIONAL_PARTIAL'].includes(result.status));
  const required = catalog.filter(source => source.required);
  const report = { run_id: runId, started_at: started, completed_at: new Date().toISOString(),
    status: cancelled ? 'CANCELLED' : required.every(source => operational.some(result => result.source_id === source.name)) ? 'PASS' : 'PARTIAL',
    scope: 'REAL_WORLD_PUBLIC_READ_ONLY', selection_scope: sources.length === catalog.length ? 'FULL_CATALOG' : 'SOURCE_SUBSET', real_employer_submissions: 0,
    catalog_sources: catalog.length, sources_selected: sources.length, platforms_attempted: [...new Set(results.filter(result => result.pages > 0 || result.policy_attempted || result.error_code?.startsWith('SOURCE_HTTP')).map(result => result.platform))],
    platforms_operational: [...new Set(operational.map(result => result.platform))],
    platforms_requiring_auth: [...new Set(results.filter(result => /AUTH_REQUIRED|USER_SESSION_REQUIRED/.test(result.status)).map(result => result.platform))],
    platforms_access_blocked: [...new Set(results.filter(result => result.status === 'ACCESS_BLOCKED').map(result => result.platform))],
    platforms_manual_fallback: [...new Set(results.filter(result => result.status === 'MANUAL_DISCOVERY_FALLBACK').map(result => result.platform))],
    required_source_coverage: required.map(source => ({ source_id: source.name, platform: source.platform,
      status: results.find(result => result.source_id === source.name)?.status ?? 'NOT_SCANNED' })),
    employer_boards_attempted: results.filter(result => result.source_class === 'employer_ats').length,
    employers_scanned: results.filter(result => result.source_class === 'employer_ats' && result.pages > 0).length,
    employers_operational: operational.filter(result => result.source_class === 'employer_ats').length,
    employer_boards_with_vacancies: operational.filter(result => result.source_class === 'employer_ats' && result.raw_count > 0).length,
    observed_hiring_companies: new Set([...jobs.values()].map(job => job.company)).size,
    raw_vacancies: results.reduce((sum, result) => sum + result.raw_count, 0), unique_vacancies: seen.size,
    new_vacancies: newIds.size, new_job_ids: [...newIds], unique_job_ids: [...seen],
    relevant_vacancies: null, keyword_evidence_vacancies: [...jobs.values()].filter(job => job.query_role_evidence.length).length,
    role_family_distribution: [...jobs.values()].reduce((counts, job) => { for (const family of job.query_role_evidence.length ? job.query_role_evidence : ['UNCLASSIFIED']) counts[family] = (counts[family] ?? 0) + 1; return counts; }, {}),
    country_distribution: distribution('country'), work_format_distribution: distribution('work_mode'), sources: results,
    limitations: ['Catalog seeds are counted as operational only after a successful live fetch; failed/empty boards remain visible.',
      'Role families are broad keyword indexing hints, not model fit or candidate eligibility. relevant_vacancies is unknown until analysis.',
      'Aggregate feed publication does not verify an employer vacancy is currently open. Reverification is mandatory before CV/application.',
      'Paginated and sitemap sources have bounded per-run limits; truncated sources are explicit. No global-market exhaustiveness claim.',
      'LinkedIn and blocked Polish sources require authorized integration or manual discovery. No login/access restriction bypass.'] };
  if (repository.pool) await repository.pool.query('UPDATE market_discovery_runs SET completed_at=now(),status=$2,report_json=$3 WHERE run_id=$1', [runId, report.status, report]);
  await emit(null, { event: 'market_completed', status: report.status, count: report.unique_vacancies,
    processed: report.raw_vacancies, unique_count: report.unique_vacancies, new_count: report.new_vacancies,
    duplicates: report.raw_vacancies - report.new_vacancies,
    message: `Real market discovery ${report.status}: ${report.unique_vacancies} unique vacancies; real submissions 0` });
  return report;
}

export async function reverifyMarketJob({ job, repository, registryPath = MARKET_REGISTRY, fetchOptions = {} }) {
  const sources = await loadMarketSources(registryPath);
  const mappings = repository.pool ? (await repository.pool.query('SELECT * FROM job_sources WHERE job_id=$1', [job.job_id])).rows : [];
  for (const mapping of mappings) {
    const source = sources.find(item => item.name === mapping.source_name);
    if (!source?.enabled || !source.permitted_access) continue;
    if(['poland_board','global_board'].includes(source.source_class)&&['public_listing_html','public_headless_jobposting'].includes(source.adapter)){
      try{
        const verified=await verifyPublicBoardPosting({source,url:mapping.source_url,fetchOptions});
        if(verified.raw){
          const refreshed={...canonicalSnapshot(job),...normalizeRaw(verified.raw),job_id:job.job_id,canonical_url:job.canonical_url,
            adapter:source.adapter,last_open_verification:{source:source.name,status:verified.status,method:verified.method,verified_at:new Date().toISOString()}};
          await repository.insertRaw?.(verified.raw);await repository.upsertCanonicalJob?.(refreshed,{source:verified.raw});
          if(repository.pool)await repository.pool.query("UPDATE jobs SET availability_status=$2,last_verified_open_at=CASE WHEN $2='OPEN' THEN now() ELSE last_verified_open_at END,closed_at=CASE WHEN $2='CLOSED' THEN COALESCE(closed_at,now()) ELSE NULL END WHERE job_id=$1",[job.job_id,verified.status]);
          return{...verified,raw:undefined,source_id:source.name,verified_at:new Date().toISOString(),job:refreshed};
        }
        if(verified.status==='CLOSED'&&repository.pool)await repository.pool.query("UPDATE jobs SET availability_status='CLOSED',closed_at=COALESCE(closed_at,now()) WHERE job_id=$1",[job.job_id]);
        return{...verified,source_id:source.name,verified_at:new Date().toISOString()};
      }catch(error){
        if(error.message==='SOURCE_HTTP_404'){
          if(repository.pool)await repository.pool.query("UPDATE jobs SET availability_status='CLOSED',closed_at=COALESCE(closed_at,now()) WHERE job_id=$1",[job.job_id]);
          return{status:'CLOSED',source_id:source.name,method:'PUBLIC_BOARD_POSTING_NOT_FOUND',verified_at:new Date().toISOString()};
        }
        return{status:'UNKNOWN',source_id:source.name,reason:error.message,verified_at:new Date().toISOString()};
      }
    }
    if (publicHtmlAdapters.has(source.adapter)) {
      try {
        const verified = await verifyPublicJobPosting({ source, url: mapping.source_url, fetchOptions });
        if(verified.reason==='AVAILABILITY_CONFLICT'){
          if(repository.pool)await repository.pool.query("UPDATE jobs SET availability_status='UNKNOWN',metadata=metadata || $2::jsonb WHERE job_id=$1",
            [job.job_id,JSON.stringify({availability_conflict:{...verified,source:source.name,verified_at:new Date().toISOString()}})]);
          return{...verified,source_id:source.name,verified_at:new Date().toISOString()};
        }
        if (verified.raw) {
          const refreshed = { ...canonicalSnapshot(job), ...normalizeRaw(verified.raw), job_id: job.job_id, canonical_url: job.canonical_url,
            adapter: source.adapter, last_open_verification: { source: source.name, status: verified.status,
              method: verified.method ?? 'OFFICIAL_PUBLIC_JOBPOSTING_GET', verified_at: new Date().toISOString() } };
          await repository.insertRaw?.(verified.raw); await repository.upsertCanonicalJob?.(refreshed, { source: verified.raw });
          if (repository.pool) await repository.pool.query(`UPDATE jobs SET availability_status=$2,last_verified_open_at=CASE WHEN $2='OPEN' THEN now() ELSE last_verified_open_at END,
            closed_at=CASE WHEN $2='CLOSED' THEN COALESCE(closed_at,now()) ELSE NULL END WHERE job_id=$1`, [job.job_id, verified.status]);
          return { status: verified.status, source_id: source.name, method: verified.method ?? 'OFFICIAL_PUBLIC_JOBPOSTING_GET',
            verified_at: new Date().toISOString(), job: refreshed };
        }
      } catch (error) {
        if (error.message === 'SOURCE_HTTP_404') {
          if (repository.pool) await repository.pool.query("UPDATE jobs SET availability_status='CLOSED',closed_at=COALESCE(closed_at,now()) WHERE job_id=$1", [job.job_id]);
          return { status: 'CLOSED', source_id: source.name, method: 'OFFICIAL_PUBLIC_POSTING_NOT_FOUND', verified_at: new Date().toISOString() };
        }
      }
      continue;
    }
    if (!['greenhouse', 'lever', 'ashby', 'smartrecruiters'].includes(source.adapter)) continue;
    try {
      let endpoint = marketEndpoint(source);
      if (source.adapter === 'greenhouse') endpoint = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.board)}/jobs/${encodeURIComponent(mapping.source_item_id)}`;
      if (source.adapter === 'lever') endpoint = `https://api.lever.co/v0/postings/${encodeURIComponent(source.board)}/${encodeURIComponent(mapping.source_item_id)}?mode=json`;
      if (source.adapter === 'smartrecruiters') endpoint = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.board)}/postings/${encodeURIComponent(mapping.source_item_id)}`;
      const response = await safeFetch(endpoint, source, fetchOptions); const data = JSON.parse(response.text);
      if (source.adapter === 'ashby' && !Array.isArray(data.jobs)) throw new Error('INVALID_OFFICIAL_BOARD_RESPONSE');
      if (source.adapter !== 'ashby' && String(data.id) !== String(mapping.source_item_id)) throw new Error('OFFICIAL_POSTING_ID_MISMATCH');
      const items = source.adapter === 'ashby' ? data.jobs : [data];
      const found = items.find(item => String(item.id) === String(mapping.source_item_id) && item.isListed !== false);
      const deadline = found && iso(found.validThrough ?? found.application_deadline);
      const closed = found && (found.closed === true || found.active === false || /^(closed|expired)$/i.test(found.status ?? '')
        || (deadline && Date.parse(deadline) <= Date.now()));
      const status = found && !closed ? 'OPEN' : 'CLOSED';
      if(status==='OPEN') {
        const raw=source.adapter==='smartrecruiters'?parseMarketPayload(source,{content:[found]},endpoint)[0]:
          {raw_payload:found,adapter:source.adapter};
        const conflict=officialDeadlineConflict(raw);
        if(conflict){
          if(repository.pool)await repository.pool.query("UPDATE jobs SET availability_status='UNKNOWN',metadata=metadata || $2::jsonb WHERE job_id=$1",
            [job.job_id,JSON.stringify({availability_conflict:{...conflict,source:source.name,verified_at:new Date().toISOString()}})]);
          return{...conflict,source_id:source.name,verified_at:new Date().toISOString()};
        }
      }
      let refreshedJob = null;
      if (found && status === 'OPEN' && source.adapter === 'smartrecruiters') {
        const records = parseMarketPayload(source, { content: [found] }, endpoint);
        const raw = records[0];
        await repository.insertRaw?.(raw);
        refreshedJob = { ...canonicalSnapshot(job), ...normalizeRaw(raw), job_id: job.job_id, canonical_url: job.canonical_url };
        await repository.upsertCanonicalJob?.(refreshedJob, { source: raw });
      }
      if (repository.pool) await repository.pool.query(`UPDATE jobs SET availability_status=$2,last_verified_open_at=CASE WHEN $2='OPEN' THEN now() ELSE last_verified_open_at END,
        closed_at=CASE WHEN $2='CLOSED' THEN COALESCE(closed_at,now()) ELSE NULL END,
        metadata=metadata || jsonb_build_object('last_open_verification',jsonb_build_object('source',$3::text,'verified_at',now(),'status',$2::text,'method','CURRENT_OFFICIAL_ATS_GET')) WHERE job_id=$1`, [job.job_id, status, source.name]);
      return { status, source_id: source.name, method: 'CURRENT_OFFICIAL_ATS_GET', verified_at: new Date().toISOString(),
        ...(refreshedJob ? { job: refreshedJob } : {}) };
    } catch (error) {
      if (error.message === 'SOURCE_HTTP_404' && ['greenhouse', 'lever', 'smartrecruiters'].includes(source.adapter)) {
        if (repository.pool) await repository.pool.query("UPDATE jobs SET availability_status='CLOSED',closed_at=COALESCE(closed_at,now()) WHERE job_id=$1", [job.job_id]);
        return { status: 'CLOSED', source_id: source.name, method: 'OFFICIAL_ATS_POSTING_NOT_FOUND', verified_at: new Date().toISOString() };
      }
    }
  }
  return { status: 'UNKNOWN', reason: 'NO_PERMITTED_OFFICIAL_OPEN_VERIFICATION', verified_at: null };
}
