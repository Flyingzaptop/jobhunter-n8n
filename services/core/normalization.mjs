import { createHash } from 'node:crypto';
import { decodeEntities, safeFetch } from './discovery.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const stableUuid = value => {
  const hex = hash(value).slice(0, 32).split('');
  hex[12] = '5'; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const id = hex.join('');
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
};
const identityText = value => textContent(value).normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function textContent(input = '') {
  return decodeEntities(input).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function canonicalizeUrl(input) {
  const url = new URL(input);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('INVALID_CANONICAL_URL');
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (url.hostname === 'boards.greenhouse.io') url.hostname = 'job-boards.greenhouse.io';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|gclid|fbclid|msclkid|ref|referrer|source|trackingId)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  return url.href;
}

const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const countryName = country => typeof country === 'object' ? country.name ?? null : country ?? null;

function atsIdentity(raw, url) {
  const host = new URL(url).hostname;
  let provider = raw.adapter;
  let board = raw.source_board;
  let id = raw.raw_payload.id;
  const parsed = new URL(url);
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (/greenhouse\.io$/.test(host)) { provider = 'greenhouse'; board = parts[0]; id = parts[parts.indexOf('jobs') + 1]; }
  if (/lever\.co$/.test(host)) { provider = 'lever'; board = parts[0]; id = parts[1]; }
  if (/ashbyhq\.com$/.test(host)) { provider = 'ashby'; board = parts[0]; id = parts[1]; }
  return ['greenhouse', 'lever', 'ashby'].includes(provider) && board && id ? `${provider}:${board}:${id}` : null;
}

export function normalizeRaw(raw, { now = new Date() } = {}) {
  const item = raw.raw_payload;
  if (!item || typeof item !== 'object') throw new Error('INVALID_RAW_PAYLOAD');
  const canonicalUrl = canonicalizeUrl(item.canonical_url ?? item.absolute_url ?? item.hostedUrl ?? item.jobUrl ?? item.url ?? raw.source_url);
  const jobLocation = Array.isArray(item.jobLocation) ? item.jobLocation[0] : item.jobLocation;
  const address = jobLocation?.address ?? item.address?.postalAddress;
  const company = textContent(item.hiringOrganization?.name ?? item.company ?? raw.company_hint);
  const title = textContent(item.title ?? item.text ?? raw.title_hint);
  const location = textContent(typeof item.location === 'string' ? item.location : item.location?.name ?? item.categories?.location
    ?? raw.location_hint ?? [address?.addressLocality, countryName(address?.addressCountry)].filter(Boolean).join(', '));
  const description = textContent(item.descriptionPlain ?? item.description_text ?? item.descriptionHtml ?? item.description ?? item.content ?? '')
    + (item.lists?.length ? ' ' + item.lists.map(list => textContent(`${list.text ?? ''} ${list.content ?? ''}`)).join(' ') : '');
  if (!company || !title) throw new Error('INSUFFICIENT_CANONICAL_IDENTITY');
  const modeValue = item.workplaceType ?? item.work_mode ?? item.jobLocationType ?? (item.isRemote === true ? 'remote' : '');
  let workMode = 'UNKNOWN';
  if (/remote|telecommute/i.test(modeValue)) workMode = 'REMOTE';
  else if (/hybrid/i.test(modeValue)) workMode = 'HYBRID';
  else if (/on[-_ ]?site|in[-_ ]?office/i.test(modeValue)) workMode = 'ONSITE';
  // Location names may explicitly say remote, but city names do not imply onsite.
  if (workMode === 'UNKNOWN' && /\bremote\b/i.test(location)) workMode = 'REMOTE';
  const validThrough = date(item.validThrough ?? item.valid_through ?? item.application_deadline);
  const closed = item.isListed === false || item.closed === true || /^(closed|expired)$/i.test(item.status ?? '')
    || (validThrough && new Date(validThrough).getTime() <= new Date(now).getTime());
  const listedFeed = ['greenhouse', 'lever', 'ashby', 'mock'].includes(raw.adapter);
  const availability = closed ? 'CLOSED' : listedFeed || item.status === 'OPEN' ? 'OPEN' : 'UNKNOWN';
  const identity = `${identityText(company)}|${identityText(title)}|${identityText(location)}`;
  const contentHash = hash(`${identity}|${identityText(description)}`);
  return {
    job_id: stableUuid(`${raw.profile ?? 'real'}|${canonicalUrl}`), canonical_url: canonicalUrl,
    application_url: canonicalizeUrl(item.applyUrl ?? item.application_url ?? canonicalUrl),
    company, title, location, country: countryName(item.country ?? address?.addressCountry), work_mode: workMode,
    employment_type: item.employmentType ?? item.employment_type ?? item.categories?.commitment ?? null,
    description_text: description.trim(), content_hash: contentHash, availability_status: availability,
    published_at: date(raw.published_at), valid_through: validThrough,
    salary: item.salaryRange ?? item.baseSalary ?? item.compensation ?? null,
    ats_identity: atsIdentity(raw, canonicalUrl), identity_key: identity, profile: raw.profile ?? 'real',
  };
}

export function duplicateConfidence(left, right) {
  if ((left.profile ?? 'real') !== (right.profile ?? 'real')) return null;
  if (left.canonical_url === right.canonical_url) return { signal: 'canonical_url', confidence: 1 };
  if (left.ats_identity && left.ats_identity === right.ats_identity) return { signal: 'ats_identity', confidence: 1 };
  if (left.ats_identity && right.ats_identity && left.ats_identity !== right.ats_identity) return null;
  // Similar titles or empty descriptions alone never merge separate requisitions.
  if (left.identity_key === right.identity_key && left.description_text.length >= 80 && right.description_text.length >= 80) {
    if (left.content_hash === right.content_hash) return { signal: 'content_fingerprint', confidence: 0.99 };
    const tokens = value => new Set(identityText(value).split(' ').filter(word => word.length > 2));
    const a = tokens(left.description_text), b = tokens(right.description_text);
    const intersection = [...a].filter(token => b.has(token)).length;
    const similarity = intersection / (a.size + b.size - intersection || 1);
    // Distinct known ATS identifiers represent distinct postings even if templated text matches.
    if (!left.ats_identity && !right.ats_identity && similarity >= 0.98 && a.size >= 30) return { signal: 'description_similarity', confidence: similarity };
  }
  return null;
}

export async function resolveVacancyUrl(url, source, options = {}) {
  // Explicit opt-in: fetching redirects is not required to normalize persisted source data.
  const result = await safeFetch(url, source, options);
  return canonicalizeUrl(result.url);
}

export async function normalizeRawRecords({ records, repository, now = new Date() }) {
  const existing = await repository.listCanonicalJobs();
  const newIds = new Set(); const seen = new Set(); const errors = [];
  for (const raw of records) {
    try {
      const job = normalizeRaw(raw, { now });
      const matches = existing.map(candidate => ({ candidate, match: duplicateConfidence(job, candidate) })).filter(item => item.match);
      matches.sort((a, b) => b.match.confidence - a.match.confidence);
      const duplicate = matches[0];
      if (duplicate) {
        job.job_id = duplicate.candidate.job_id;
        job.canonical_url = duplicate.candidate.canonical_url;
        job.ats_identity ??= duplicate.candidate.ats_identity;
        if (job.work_mode === 'UNKNOWN') job.work_mode = duplicate.candidate.work_mode;
        if (job.availability_status === 'UNKNOWN') job.availability_status = duplicate.candidate.availability_status;
        for (const field of ['country', 'employment_type', 'published_at', 'valid_through', 'salary']) {
          job[field] ??= duplicate.candidate[field] ?? null;
        }
        if (!raw.raw_payload.applyUrl && !raw.raw_payload.application_url) {
          job.application_url = duplicate.candidate.application_url;
        }
        if (!job.description_text) {
          job.description_text = duplicate.candidate.description_text;
          job.content_hash = hash(`${job.identity_key}|${identityText(job.description_text)}`);
        }
      }
      const saved = await repository.upsertCanonicalJob(job, { source: raw, duplicate_signal: duplicate?.match ?? null });
      job.job_id = saved.job_id;
      seen.add(saved.job_id);
      if (saved.is_new) newIds.add(saved.job_id);
      const index = existing.findIndex(candidate => candidate.job_id === saved.job_id);
      if (index < 0) existing.push(job); else existing[index] = job;
    } catch (error) { errors.push({ raw_id: raw.raw_id ?? null, error: error.message }); }
  }
  return { raw_count: records.length, canonical_count: seen.size, new_job_ids: [...newIds], errors };
}
