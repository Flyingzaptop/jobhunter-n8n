import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { robotsAllows, loadMarketSources, parseMarketPayload, runMarketDiscovery, queryEvidence, reverifyMarketJob, verifyPublicJobPosting,extractExplicitApplicationDeadlines,officialDeadlineConflict,publicListingJobUrls } from '../services/core/discovery-v2.mjs';
import { normalizeRaw } from '../services/core/normalization.mjs';

test('public detail retry survives cursor movement and repeated failures beyond two attempts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'public-retry-')),registryPath=join(dir,'sources.yaml');
 const root='https://board.example/search',detail='https://board.example/engineer_1.html';
 await writeFile(registryPath,YAML.stringify({sources:[{name:'retry-board',platform:'Praca.pl',adapter:'public_listing_html',url:root,profile:'real',enabled:true,source_class:'poland_board',permitted_access:true,allowed_hosts:['board.example'],job_link_pattern:'_[0-9]+\\.html$',max_pages:1}]}));
 let metadata={listing_root_url:root,next_listing_page_url:root+'?page=2',pending_details:[{url:detail,listing_url:root,attempts:5,next_retry_at:'2000-01-01T00:00:00Z'}]}, fail=true,stored=0;
 const repository={pool:{async query(sql,args){
  if(sql.startsWith('SELECT * FROM market_source_health'))return{rows:[{metadata}]};
  if(sql.startsWith('INSERT INTO market_source_health'))metadata=args.at(-1);
  return{rows:[]};
 }},async listCanonicalJobs(){return[];},async insertRaw(raw){return{...raw,raw_id:'raw'};},async upsertCanonicalJob(job){stored++;return{job_id:job.job_id,is_new:true};}};
 const fetchOptions={lookupImpl:async()=>[{address:'8.8.8.8',family:4}],sleepImpl:async()=>{},fetchImpl:async url=>{
  if(url.pathname==='/search')return new Response(url.search?'':`<a href="${detail}">Engineer</a>`);
  if(fail)return new Response('temporary error',{status:500});
  return new Response(`<script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',title:'Mechanical engineer',hiringOrganization:{name:'Employer'},description:'Mechanical engineering and CAD design. '.repeat(6),url:detail})}</script>`);
 }};
 try{
  const first=await runMarketDiscovery({repository,registryPath,fetchOptions});
  assert.equal(metadata.pending_details[0].attempts,6);assert.equal(metadata.pending_details[0].listing_url,root);
  assert.equal(first.sources[0].cycle_completed,false);assert.equal(stored,0);
  metadata.pending_details[0].next_retry_at='2000-01-01T00:00:00Z';fail=false;
  await runMarketDiscovery({repository,registryPath,fetchOptions});
  assert.equal(metadata.pending_details.length,0);assert.equal(stored,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('robots wildcard, query patterns and specific agent groups cannot be bypassed', () => {
  const text = 'User-agent: Googlebot\nAllow: /\nUser-agent: *\nDisallow: /api/\nDisallow: /*?*\nAllow: /feed?*\n';
  assert.equal(robotsAllows(text, 'https://board.example/api/jobs'), false);
  assert.equal(robotsAllows(text, 'https://board.example/search?q=python'), false);
  assert.equal(robotsAllows(text, 'https://board.example/feed?page=2'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\nUser-agent: JobHunter\nDisallow: /secret\nAllow: /', 'https://board.example/secret'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /', 'https://linkedin.com/jobs'), false);
});
test('catalog covers real source classes without presenting unverified boards as operational', async () => {
  const sources = await loadMarketSources();
  assert.ok(sources.filter(source => source.source_class === 'employer_ats').length >= 100);
  for (const name of ['praca', 'pracuj', 'olx', 'justjoin', 'nofluff', 'rocketjobs', 'linkedin']) assert.ok(sources.some(source => source.name === name));
  assert.equal(sources.some(source => source.profile === 'mock'), false);
  assert.equal(sources.find(source => source.name === 'linkedin').adapter, 'public_listing_html');
  assert.equal(sources.find(source => source.name === 'linkedin').permitted_access, true);
  assert.equal(sources.find(source => source.name === 'nofluff').permitted_access, false);
});
test('public board discovery uses unique current same-origin vacancy links without profile/API links',()=>{
 const source={url:'https://www.praca.pl/',job_link_pattern:'_[0-9]+\\.html$'};
 const html='<a href="/mechanical_123.html">Engineer</a><a href="https://www.praca.pl/mechanical_123.html">dup</a><a href="https://evil.example/job_123.html">offhost</a><a href="/api/jobs">api</a><a href="/wroclaw.html">city</a>';
 assert.deepEqual(publicListingJobUrls(source,html),['https://www.praca.pl/mechanical_123.html']);
 assert.throws(()=>publicListingJobUrls({url:source.url},html),/PUBLIC_LISTING_JOB_PATTERN_REQUIRED/);
 assert.deepEqual(publicListingJobUrls({...source,listing_page_pattern:'^/praca(?:_[0-9]+)?\\.html$'},'<a href="/praca_2.html">Next</a><a href="/engineer_123.html">Job</a>'),['https://www.praca.pl/engineer_123.html']);
});
test('public board scan continues after malformed detail and preserves source provenance for valid vacancies',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'public-board-'));const path=join(dir,'registry.yaml');
 await writeFile(path,YAML.stringify({sources:[{name:'praca-test',platform:'Praca.pl',adapter:'public_listing_html',url:'https://board.example/',robots_url:'https://board.example/robots.txt',profile:'real',enabled:true,source_class:'poland_board',permitted_access:true,allowed_hosts:['board.example'],job_link_pattern:'_[0-9]+\\.html$',max_pages:3}]}));
 const sources=[];const repository={async listCanonicalJobs(){return[];},async insertRaw(raw){sources.push(raw);return{raw_id:'raw'};},async upsertCanonicalJob(job){return{job_id:job.job_id,is_new:true};}};
 const listing='<a href="/bad_1.html">bad</a><a href="/engineer_2.html">engineer</a>';
 try{const result=await runMarketDiscovery({repository,registryPath:path,fetchOptions:{lookupImpl:async()=>[{address:'8.8.8.8',family:4}],sleepImpl:async()=>{},fetchImpl:async(url)=>{
  if(url.pathname==='/robots.txt')return new Response('User-agent: *\nDisallow: /api/');
  if(url.pathname==='/')return new Response(listing);
  const data=url.pathname==='/bad_1.html'?{'@type':'JobPosting'}:{'@type':'JobPosting',title:'Mechanical engineer',hiringOrganization:{name:'Employer'},description:'Mechanical engineering and CAD design. '.repeat(6),jobLocation:{address:{addressLocality:'Wrocław',addressCountry:'PL'}}};
  return new Response(`<script type="application/ld+json">${JSON.stringify(data)}</script>`);
 }}});
 assert.equal(result.sources[0].status,'OPERATIONAL_PARTIAL');assert.equal(result.raw_vacancies,1);assert.equal(result.sources[0].duplicate_count,0);
 assert.equal(sources[0].source_name,'praca-test');assert.equal(sources[0].source_url,'https://board.example/engineer_2.html');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('remote board metadata preserves restrictions and unknown employer freshness', () => {
  const source = { name: 'remotive', adapter: 'remotive', url: 'https://remotive.com/api/remote-jobs' };
  const raws = parseMarketPayload(source, { jobs: [{ id: 2, title: 'Python developer', company_name: 'Employer',
    url: 'https://remotive.com/remote-jobs/2', candidate_required_location: 'United States', description: 'Python for scientific simulation', publication_date: '2026-10-03' }] });
  const job = normalizeRaw(raws[0]);
  assert.equal(job.location, 'United States'); assert.equal(job.work_mode, 'REMOTE');
  assert.equal(job.availability_status, 'UNKNOWN'); assert.equal(job.country, null);
  assert.ok(queryEvidence(job).includes('PYTHON_ML_DATA'));
});
test('HTML JobPosting without URL uses fetched vacancy URL rather than sitemap URL', () => {
  const source = { name: 'justjoin', adapter: 'html', url: 'https://justjoin.it/sitemaps/active-jobs.xml' };
  const html = '<script type="application/ld+json">{"@type":"JobPosting","title":"Engineer","hiringOrganization":{"name":"Employer"}}</script>';
  const [raw] = parseMarketPayload(source, html, 'https://justjoin.it/job-offer/employer-engineer');
  assert.equal(normalizeRaw(raw).canonical_url, 'https://justjoin.it/job-offer/employer-engineer');
});
test('Ashby unlisted jobs excluded and SmartRecruiters description absence explicit', () => {
  const ashby = parseMarketPayload({ name: 'a', adapter: 'ashby', board: 'a' }, { jobs: [
    { id: '1', title: 'Listed', jobUrl: 'https://jobs.ashbyhq.com/a/1', isListed: true },
    { id: '2', title: 'Unlisted', jobUrl: 'https://jobs.ashbyhq.com/a/2', isListed: false },
  ] });
  assert.equal(ashby.length, 1);
  const [raw] = parseMarketPayload({ name: 's', adapter: 'smartrecruiters', board: 'employer', company: 'Employer' }, {
    content: [{ id: '3', name: 'Validation engineer', location: { city: 'Wrocław', country: 'pl' } }],
  });
  const job = normalizeRaw(raw); assert.equal(job.country, 'pl'); assert.equal(job.availability_status, 'OPEN');
  assert.equal(job.description_text, ''); assert.equal(raw.raw_payload.description_status, 'DETAIL_NOT_FETCHED');
});
test('bounded discovery persists broad vacancies, preserves cross-source mappings, reports blocked access truthfully', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobhunter-market-'));
  const path = join(dir, 'registry.yaml');
  const base = { platform: 'Greenhouse', adapter: 'greenhouse', company: 'Employer', source_class: 'employer_ats', profile: 'real',
    permitted_access: true, allowed_hosts: ['boards-api.greenhouse.io'], rate_limit_ms: 250 };
  await writeFile(path, YAML.stringify({ sources: [{ ...base, name: 'one', board: 'one' }, { ...base, name: 'two', board: 'two' },
    { name: 'linkedin', platform: 'LinkedIn Jobs', adapter: 'policy_probe', profile: 'real', permitted_access: false,
      url: 'https://www.linkedin.com/robots.txt', allowed_hosts: ['www.linkedin.com'], discovery_capability: 'USER_SESSION_REQUIRED', required: true }] }));
  const stored = new Map(); const mappings = []; const events = []; let requests = 0;
  const repository = { async listCanonicalJobs() { return []; }, async insertRaw(raw) { return { ...raw, raw_id: 'raw' }; },
    async upsertCanonicalJob(job, { source }) { const is_new = !stored.has(job.canonical_url); stored.set(job.canonical_url, job); mappings.push(source.source_name); return { job_id: job.job_id, is_new }; } };
  try {
    const report = await runMarketDiscovery({ repository, registryPath: path, observer: event => { events.push(event); }, fetchOptions: {
      lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }], sleepImpl: async () => {},
      fetchImpl: async (url, options) => { assert.equal(options.method, 'GET'); requests++;
        if (url.hostname === 'www.linkedin.com') return new Response('User-agent: *\nDisallow: /');
        return new Response(JSON.stringify({ jobs: [{ id: '42', title: 'Unusual position without matching title keywords',
          absolute_url: 'https://job-boards.greenhouse.io/employer/jobs/42', content: 'Broad role description', location: { name: 'Europe' } }] })); },
    } });
    assert.equal(report.raw_vacancies, 2); assert.equal(report.unique_vacancies, 1); assert.equal(report.new_vacancies, 1);
    assert.deepEqual(mappings, ['one', 'two']); assert.equal(report.relevant_vacancies, null); assert.equal(report.status, 'PARTIAL');
    assert.equal(requests, 3); assert.equal(report.sources[2].status, 'USER_SESSION_REQUIRED');
    assert.equal(report.real_employer_submissions, 0); assert.ok(events.some(event => event.event === 'source_progress'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('downstream freshness verification uses official posting GET and treats expired/404 as closed', async () => {
  const updates = [];
  const repository = { pool: { async query(sql, args) {
    if (sql.startsWith('SELECT')) return { rows: [{ source_name: 'greenhouse-canonical', source_item_id: '123' }] };
    updates.push({ sql, args }); return { rows: [] };
  } } };
  const fetchOptions = { lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }], sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      assert.equal(options.method, 'GET'); assert.equal(url.hostname, 'boards-api.greenhouse.io');
      assert.ok(url.pathname.endsWith('/jobs/123'));
      return new Response(JSON.stringify({ id: 123, application_deadline: '2000-01-01T00:00:00Z' }));
    } };
  const closed = await reverifyMarketJob({ job: { job_id: 'job' }, repository, fetchOptions });
  assert.equal(closed.status, 'CLOSED'); assert.ok(updates.length);
  const missing = await reverifyMarketJob({ job: { job_id: 'job' }, repository,
    fetchOptions: { ...fetchOptions, fetchImpl: async () => new Response('', { status: 404 }) } });
  assert.equal(missing.status, 'CLOSED');
  const unknown = await reverifyMarketJob({ job: { job_id: 'job' }, repository: { pool: { async query() { return { rows: [{ source_name: 'remoteok' }] }; } } },
    fetchOptions: { ...fetchOptions, fetchImpl: async () => { throw new Error('Aggregator must not be fetched as official employer proof'); } } });
  assert.equal(unknown.status, 'UNKNOWN');
});
test('SmartRecruiters detail is hydrated from official sections before fit/CV', async () => {
  let hydrated = null;
  const repository = { pool: { async query(sql) { return { rows: sql.startsWith('SELECT') ? [{ source_name: 'smartrecruiters-BoschGroup', source_item_id: '42' }] : [] }; } },
    async insertRaw(raw) { return raw; }, async upsertCanonicalJob(job) { hydrated = job; return { job_id: job.job_id }; } };
  const verification = await reverifyMarketJob({ job: { job_id: 'existing-job', canonical_url: 'https://jobs.smartrecruiters.com/BoschGroup/42',
    metadata: { adapter: 'smartrecruiters', discovery_open_verification: { method: 'OFFICIAL_PUBLISHED_ATS_FEED_GET' } } }, repository,
    fetchOptions: { lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }], sleepImpl: async () => {},
      fetchImpl: async (url, options) => { assert.equal(options.method, 'GET'); assert.equal(url.hostname, 'api.smartrecruiters.com');
        return new Response(JSON.stringify({ id: '42', name: 'Simulation Engineer', company: { name: 'Bosch' },
          location: { city: 'Wrocław', country: 'pl' }, jobAd: { sections: { qualifications: { title: 'Qualifications', text: '<p>Python and CFD experience required.</p>' } } } })); } } });
  assert.equal(verification.status, 'OPEN'); assert.equal(verification.job.job_id, 'existing-job');
  assert.match(hydrated.description_text, /Qualifications\nPython and CFD experience required/);
  assert.equal(hydrated.company, 'Bosch'); assert.equal(hydrated.country, 'pl');
  assert.equal(Object.hasOwn(hydrated, 'metadata'), false); assert.equal(hydrated.adapter, 'smartrecruiters');
  assert.equal(hydrated.discovery_open_verification.method, 'OFFICIAL_PUBLISHED_ATS_FEED_GET');
});
test('official access errors, malformed detail and wrong IDs cannot claim vacancy OPEN', async () => {
  let writes = 0;
  const repository = { pool: { async query(sql) {
    if (sql.startsWith('SELECT')) return { rows: [{ source_name: 'greenhouse-canonical', source_item_id: '42' }] };
    writes++; return { rows: [] };
  } } };
  const fetchOptions = { lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }], sleepImpl: async () => {} };
  for (const response of [new Response('', { status: 403 }), new Response(JSON.stringify({ error: 'temporary error' })), new Response(JSON.stringify({ id: '99' }))]) {
    const result = await reverifyMarketJob({ job: { job_id: 'existing-job' }, repository,
      fetchOptions: { ...fetchOptions, fetchImpl: async () => response } });
    assert.equal(result.status, 'UNKNOWN');
  }
  assert.equal(writes, 0);
});
test('inactive official SmartRecruiters detail is CLOSED despite a reachable URL', async () => {
  const repository = { pool: { async query(sql) { return { rows: sql.startsWith('SELECT') ? [{ source_name: 'smartrecruiters-BoschGroup', source_item_id: '42' }] : [] }; } } };
  const result = await reverifyMarketJob({ job: { job_id: 'existing-job' }, repository,
    fetchOptions: { lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }], sleepImpl: async () => {},
      fetchImpl: async () => new Response(JSON.stringify({ id: '42', active: false })) } });
  assert.equal(result.status, 'CLOSED');
  const [raw] = parseMarketPayload({ name: 'bosch', adapter: 'smartrecruiters', company: 'Bosch', board: 'BoschGroup' },
    { content: [{ id: '42', name: 'Inactive role', active: false }] });
  assert.equal(normalizeRaw(raw).availability_status, 'CLOSED');
});
const publicSource = { name: 'public-employer-regression', platform: 'Teamtailor', adapter: 'teamtailor_public_html',
  url: 'https://career.teamtailor.com/jobs', robots_url: 'https://career.teamtailor.com/robots.txt',
  allowed_hosts: ['career.teamtailor.com'], rate_limit_ms: 250 };
const publicUrl = 'https://career.teamtailor.com/jobs/42-engineer';
const publicPage = extra => '<script type="application/ld+json">' + JSON.stringify({ '@type': 'JobPosting',
  title: 'Regression Engineer', hiringOrganization: { name: 'Regression Employer' }, description: 'Detailed public job description '.repeat(8), ...extra }) + '</script>';
const publicFetchOptions = text => ({ lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }], sleepImpl: async () => {}, fetchImpl: async () => new Response(text) });
test('official public JobPosting is OPEN only with fresh permitted index membership and exact detail', async () => {
  const result = await verifyPublicJobPosting({ source: publicSource, url: publicUrl, robotsText: 'User-agent: *\nAllow: /',
    listingText: `<a href="${publicUrl}">Open role</a>`, fetchOptions: publicFetchOptions(publicPage()) });
  assert.equal(result.status, 'OPEN'); assert.equal(result.method, 'OFFICIAL_PUBLIC_LISTING_AND_JOBPOSTING_GET');
  assert.equal(normalizeRaw(result.raw).canonical_url, publicUrl); assert.equal(normalizeRaw(result.raw).availability_status, 'OPEN');
  const expired = await verifyPublicJobPosting({ source: publicSource, url: publicUrl, robotsText: 'User-agent: *\nAllow: /',
    listingText: `<a href="${publicUrl}">Open role</a>`, fetchOptions: publicFetchOptions(publicPage({ validThrough: '2000-01-01T00:00:00Z' })) });
  assert.equal(expired.status, 'CLOSED');
});
test('public HTML verification fails closed for forbidden/unusable robots without fetching job details', async () => {
  let fetched = 0;
  const options = { ...publicFetchOptions('<html>Application shell</html>'), fetchImpl: async url => {
    fetched++; assert.equal(url.pathname, '/robots.txt'); return new Response('<!DOCTYPE html><html>Application shell</html>'); } };
  await assert.rejects(verifyPublicJobPosting({ source: publicSource, url: publicUrl, fetchOptions: options }), /INVALID_ROBOTS_PAYLOAD/);
  assert.equal(fetched, 1);
  await assert.rejects(verifyPublicJobPosting({ source: publicSource, url: publicUrl, robotsText: 'User-agent: *\nDisallow: /jobs',
    fetchOptions: { ...options, fetchImpl: () => { throw new Error('Forbidden detail fetched'); } } }), /ROBOTS_ACCESS_BLOCKED/);
});
test('missing current listing or mismatched JobPosting identity stays UNKNOWN', async () => {
  const missing = await verifyPublicJobPosting({ source: publicSource, url: publicUrl, robotsText: 'User-agent: *\nAllow: /',
    listingText: '<a href="/jobs/99-other-role">Other</a>', fetchOptions: { ...publicFetchOptions(''), fetchImpl: () => { throw new Error('Unlisted detail fetched'); } } });
  assert.equal(missing.status, 'UNKNOWN');
  const mismatch = await verifyPublicJobPosting({ source: publicSource, url: publicUrl, robotsText: 'User-agent: *\nAllow: /',
    listingText: `<a href="${publicUrl}">Open role</a>`, fetchOptions: publicFetchOptions(publicPage({ url: 'https://career.teamtailor.com/jobs/99-other-role' })) });
  assert.equal(mismatch.status, 'UNKNOWN');
});
test('only explicitly labeled application deadlines with unambiguous year create availability conflicts',()=>{
 const now=new Date('2026-10-04T12:00:00Z');
 const past=officialDeadlineConflict({raw_payload:{content:'Application Deadline: Friday, 28th August 2026'}},{now});
 assert.equal(past.reason,'AVAILABILITY_CONFLICT');assert.equal(past.status,'UNKNOWN');assert.equal(past.deadlines[0].deadline_date,'2026-08-28');
 assert.equal(officialDeadlineConflict({raw_payload:{content:'Application Deadline: 31 December 2026'}},{now}),null);
 assert.equal(officialDeadlineConflict({raw_payload:{content:'Start Date: November 2026\nCourse graduation: 2025\nInternship beginning: May 2026'}},{now}),null);
 assert.equal(extractExplicitApplicationDeadlines('Bewerbungsschluss: 28.08.2026')[0].deadline_date,'2026-08-28');
 assert.equal(extractExplicitApplicationDeadlines('Termin składania aplikacji: 28 sierpnia 2026')[0].deadline_date,'2026-08-28');
 assert.equal(extractExplicitApplicationDeadlines('Application deadline: 08/12/2026').length,0);
 assert.equal(extractExplicitApplicationDeadlines('Application deadline: 31 February 2026').length,0);
});
test('fresh listed official detail with past textual deadline becomes UNKNOWN with persisted conflict evidence',async()=>{
 const updates=[];const repository={pool:{async query(sql,args){if(sql.startsWith('SELECT'))return{rows:[{source_name:'greenhouse-canonical',source_item_id:'42'}]};updates.push({sql,args});return{rows:[]};}}};
 const result=await reverifyMarketJob({job:{job_id:'existing-job'},repository,fetchOptions:{lookupImpl:async()=>[{address:'8.8.8.8',family:4}],sleepImpl:async()=>{},
   fetchImpl:async()=>new Response(JSON.stringify({id:42,title:'Intern',content:'Application Deadline: 28 August 2020'}))}});
 assert.equal(result.status,'UNKNOWN');assert.equal(result.reason,'AVAILABILITY_CONFLICT');assert.equal(result.official_feed_listed,true);
 assert.ok(updates.some(x=>x.sql.includes("availability_status='UNKNOWN'")));assert.ok(updates.some(x=>x.args[1].includes('2020-08-28')));
});
