import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { discoverSources, parseSourcePayload, safeFetch, validateFetchUrl, sourceEndpoint } from '../services/core/discovery.mjs';
import { fixtureRecords, memoryRepository } from './fixtures/discovery-helper.mjs';

test('seven fixture discoveries preserve three formats and non-mechanical roles', async () => {
  const records = await fixtureRecords();
  assert.equal(records.length, 7);
  assert.deepEqual(new Set(records.map(raw => raw.adapter)), new Set(['greenhouse', 'lever', 'rss']));
  assert.equal(records.filter(raw => /Python/.test(raw.title_hint)).length, 2);
  assert.equal(records.filter(raw => /Robotics/.test(raw.title_hint)).length, 2);
  assert.match(records[0].raw_payload.content, /<p>/);
});

test('discovery persists exact metadata, only GETs and survives source failure', async () => {
  const payload = await readFile(new URL('fixtures/discovery-greenhouse.json', import.meta.url), 'utf8');
  const source = { name: 'gh-test', adapter: 'greenhouse', board: 'fixture', company: 'Fixture', permitted_access: true,
    allowed_hosts: ['boards-api.greenhouse.io'], rate_limit_ms: 250 };
  const calls = [];
  const repository = memoryRepository();
  const result = await discoverSources({ sources: [source, { ...source, name: 'denied', permitted_access: false }], repository,
    lookupImpl: async () => [{ address: '8.8.8.8' }],
    fetchImpl: async (url, options) => { calls.push([url.href, options]); return new Response(payload); } });
  assert.equal(result.discovered, 2);
  assert.equal(repository.raw.size, 2);
  assert.equal(result.errors[0].error, 'ACCESS_NOT_CONFIGURED_AS_PERMITTED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].method, 'GET');
  const expected = parseSourcePayload(source, payload);
  for (const [index, row] of [...repository.raw.values()].entries()) {
    const { raw_id, ...metadata } = row;
    assert.deepEqual(metadata, expected[index]);
  }
});

test('real network access rejects private DNS, disallowed hosts and credential URLs', async () => {
  const source = { allowed_hosts: ['safe.example', '127.0.0.1'] };
  await assert.rejects(validateFetchUrl('https://safe.example', source, async () => [{ address: '10.1.2.3' }]), /PRIVATE_NETWORK_BLOCKED/);
  await assert.rejects(validateFetchUrl('https://other.example', source), /HOST_NOT_ALLOWED/);
  await assert.rejects(validateFetchUrl('https://username:password@safe.example', source), /UNSAFE_URL/);
  await assert.rejects(validateFetchUrl('http://127.0.0.1', { ...source, allow_local_mock: true, profile: 'real' }), /HTTPS_REQUIRED/);
  await validateFetchUrl('http://127.0.0.1:3002', { profile: 'mock', allow_local_mock: true });
});

test('redirect is revalidated before second GET and response size is bounded', async () => {
  const source = { allowed_hosts: ['redirect.example'], max_response_bytes: 10 };
  let calls = 0;
  await assert.rejects(safeFetch('https://redirect.example', source, { lookupImpl: async () => [{ address: '8.8.4.4' }],
    fetchImpl: async () => { calls++; return new Response('', { status: 302, headers: { location: 'http://169.254.169.254/latest' } }); } }), /HTTPS_REQUIRED/);
  assert.equal(calls, 1);
  await assert.rejects(safeFetch('https://size.example', { ...source, allowed_hosts: ['size.example'] }, {
    lookupImpl: async () => [{ address: '8.8.4.4' }], fetchImpl: async () => new Response('12345678901'),
  }), /RESPONSE_TOO_LARGE/);
});

test('Ashby, HTML JSON-LD and manual adapter contract', () => {
  const ashby = { name: 'ashby-test', adapter: 'ashby', board: 'sample', company: 'Sample' };
  assert.match(sourceEndpoint(ashby), /posting-api\/job-board\/sample/);
  const [job] = parseSourcePayload(ashby, { jobs: [{ id: 'abc', title: 'Data Scientist', jobUrl: 'https://jobs.ashbyhq.com/sample/abc', location: 'Europe', isRemote: true }] });
  assert.equal(job.source_item_id, 'abc');
  const [html] = parseSourcePayload({ name: 'html', adapter: 'html', url: 'https://sample.example/jobs' },
    '<script type="application/ld+json">{"@graph":[{"@type":"JobPosting","title":"Engineer","url":"/job/1","hiringOrganization":{"name":"Sample"}}]}</script>');
  assert.equal(html.company_hint, 'Sample');
  assert.equal(html.source_url, 'https://sample.example/job/1');
  assert.equal(parseSourcePayload({ name: 'manual', adapter: 'manual', items: [{ title: 'Test', company: 'Sample', url: 'https://sample.example/job/2' }] })[0].title_hint, 'Test');
});
