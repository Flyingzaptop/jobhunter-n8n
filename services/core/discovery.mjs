import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hostQueues = new Map();
const lastRequest = new Map();
const digest = text => createHash('sha256').update(String(text)).digest('hex');

export function isPublicAddress(address) {
  const value = address.toLowerCase();
  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0))
      || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  // Public IPv6 global unicast only; mapped IPv4 and link/site-local are rejected.
  return isIP(value) === 6 && /^[23][0-9a-f]{0,3}:/.test(value) && !value.startsWith('2001:db8:');
}

export async function validateFetchUrl(input, source, lookupImpl = lookup) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('UNSAFE_URL');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const mockAllowed = source.profile === 'mock' && source.allow_local_mock === true
    && ['localhost', '127.0.0.1', '::1', 'mock-job-board'].includes(host);
  if (mockAllowed) return url;
  if (url.protocol !== 'https:') throw new Error('HTTPS_REQUIRED');
  if (!source.allowed_hosts?.map(h => h.toLowerCase()).includes(host)) throw new Error('HOST_NOT_ALLOWED');
  const addresses = isIP(host) ? [{ address: host }] : await lookupImpl(host, { all: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('PRIVATE_NETWORK_BLOCKED');
  return url;
}

// Validate the addresses used by the actual socket lookup too, closing DNS-rebinding
// between initial validation and connect. An injected transport is for tests only.
async function socketFetch(url, options, source, lookupImpl) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const mockAllowed = source.profile === 'mock' && source.allow_local_mock === true
      && ['localhost', '127.0.0.1', '::1', 'mock-job-board'].includes(hostname);
    const request = transport(url, {
      method: options.method, headers: options.headers, signal: options.signal,
      lookup: (host, lookupOptions, callback) => {
        lookupImpl(host, { all: true }).then(addresses => {
          if (!addresses.length || (!mockAllowed && addresses.some(item => !isPublicAddress(item.address)))) {
            callback(new Error('PRIVATE_NETWORK_BLOCKED')); return;
          }
          const family = lookupOptions.family;
          const candidates = family ? addresses.filter(item => item.family === family) : addresses;
          if (!candidates.length) { callback(new Error('NO_VALID_DNS_ADDRESS')); return; }
          if (lookupOptions.all) callback(null, candidates);
          else callback(null, candidates[0].address, candidates[0].family);
        }, callback);
      },
    }, response => {
      const status = response.statusCode;
      resolve(new Response([204, 304].includes(status) ? null : Readable.toWeb(response), {
        status, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined)
          .map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value])),
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

export async function safeFetch(input, source, { fetchImpl, lookupImpl = lookup, sleepImpl = sleep } = {}) {
  let url = new URL(input);
  const maxBytes = source.max_response_bytes ?? 5_000_000;
  for (let redirects = 0; redirects <= 5; redirects++) {
    url = await validateFetchUrl(url, source, lookupImpl);
    const host = url.host;
    const previous = hostQueues.get(host) ?? Promise.resolve();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    hostQueues.set(host, previous.then(() => gate));
    await previous;
    let response;
    try {
      const interval = Math.max(250, source.rate_limit_ms ?? 1500);
      const wait = interval - (Date.now() - (lastRequest.get(host) ?? 0));
      if (wait > 0) await sleepImpl(wait);
      lastRequest.set(host, Date.now());
      const signal = AbortSignal.timeout(source.timeout_ms ?? 15_000);
      const options = { method: 'GET', redirect: 'manual', signal,
        headers: { 'User-Agent': 'JobHunter/0.1 (+local non-submitting vacancy discovery)', Accept: 'application/json, application/xml, text/html;q=0.8', 'Accept-Encoding': 'identity' } };
      response = fetchImpl ? await fetchImpl(url, options) : await socketFetch(url, options, source, lookupImpl);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 5) throw new Error('REDIRECT_LIMIT');
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`SOURCE_HTTP_${response.status}`); }
      if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('RESPONSE_TOO_LARGE'); }
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > maxBytes) { throw new Error('RESPONSE_TOO_LARGE'); }
        chunks.push(Buffer.from(chunk));
      }
      return { text: Buffer.concat(chunks).toString('utf8'), url: url.href, status: response.status };
    } finally { release(); }
  }
  throw new Error('REDIRECT_LIMIT');
}

export function decodeEntities(value = '') {
  let text = String(value);
  for (let pass = 0; pass < 2; pass++) text = text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, name) => {
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (name[0] !== '#') return entities[name.toLowerCase()] ?? match;
    const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
  });
  return text;
}

const tag = (xml, name) => decodeEntities((xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] ?? '').replace(/^<!\[CDATA\[|\]\]>$/g, ''));
export function extractJobPostings(html) {
  const postings = [];
  const visit = item => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) return item.forEach(visit);
    if ([item['@type']].flat().includes('JobPosting')) postings.push(item);
    if (item['@graph']) visit(item['@graph']);
  };
  for (const match of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { /* Other malformed structured data does not erase valid postings. */ }
  }
  return postings;
}

export function sourceEndpoint(source) {
  const board = encodeURIComponent(source.board ?? '');
  if (source.adapter === 'greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`;
  if (source.adapter === 'lever') return `https://${source.region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co'}/v0/postings/${board}?mode=json`;
  if (source.adapter === 'ashby') return `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`;
  return source.url;
}

export function parseSourcePayload(source, payload, fetchedUrl = sourceEndpoint(source)) {
  const adapter = source.adapter;
  let items;
  if (['greenhouse', 'lever', 'ashby', 'json', 'mock'].includes(adapter)) {
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    items = Array.isArray(data) ? data : data.jobs ?? data.items;
    if (!Array.isArray(items)) throw new Error('INVALID_SOURCE_PAYLOAD');
  } else if (adapter === 'rss') {
    items = [...String(payload).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(([, xml]) => ({
      id: tag(xml, 'guid'), title: tag(xml, 'title'), url: tag(xml, 'link'), description: tag(xml, 'description'),
      published_at: tag(xml, 'pubDate'), company: tag(xml, 'company') || source.company, location: tag(xml, 'location') }));
  } else if (adapter === 'html') {
    items = extractJobPostings(payload);
    if (!items.length) throw new Error('NO_JOBPOSTING_STRUCTURED_DATA');
  } else if (adapter === 'manual') {
    items = source.items ?? [];
  } else throw new Error(`UNSUPPORTED_ADAPTER_${adapter}`);
  return items.map(item => {
    const location = item.jobLocation?.address;
    const sourceUrl = item.absolute_url ?? item.hostedUrl ?? item.jobUrl ?? item.url ?? source.url;
    if (!sourceUrl) throw new Error('MISSING_VACANCY_URL');
    const resolvedUrl = new URL(sourceUrl, fetchedUrl).href;
    const id = item.id ?? item.identifier?.value ?? item.identifier ?? digest(resolvedUrl);
    if (typeof id === 'object') throw new Error('INVALID_SOURCE_ITEM_ID');
    return {
      source_name: source.name, source_item_id: String(id), source_url: resolvedUrl,
      title_hint: item.title ?? item.text ?? '', company_hint: item.hiringOrganization?.name ?? item.company ?? source.company ?? '',
      location_hint: typeof item.location === 'string' ? item.location : item.location?.name ?? item.categories?.location
        ?? [location?.addressLocality, location?.addressCountry].filter(Boolean).join(', '),
      published_at: item.publishedAt ?? item.published_at ?? item.datePosted ?? item.first_published ?? null,
      raw_payload: structuredClone(item), adapter, source_board: source.board ?? null, profile: source.profile ?? 'real',
    };
  });
}

export async function discoverSources({ sources, repository, fetchImpl, lookupImpl, logger = () => {} }) {
  const result = { raw_ids: [], discovered: 0, errors: [], source_results: [] };
  for (const source of sources.filter(item => item.enabled !== false)) {
    try {
      if (source.profile !== 'mock' && source.permitted_access !== true) throw new Error('ACCESS_NOT_CONFIGURED_AS_PERMITTED');
      const response = source.adapter === 'manual' ? { text: '', url: source.url } :
        await safeFetch(sourceEndpoint(source), source, { fetchImpl, lookupImpl });
      const records = parseSourcePayload(source, response.text, response.url);
      for (const raw of records) {
        const saved = await repository.insertRaw(raw);
        result.raw_ids.push(saved.raw_id);
      }
      result.discovered += records.length;
      result.source_results.push({ source_name: source.name, discovered: records.length });
      logger({ event: 'source_discovered', source_name: source.name, count: records.length });
    } catch (error) {
      result.errors.push({ source_name: source.name, error: error.message });
      logger({ event: 'source_error', source_name: source.name, error: error.message });
    }
  }
  return result;
}
