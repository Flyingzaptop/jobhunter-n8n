import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeUrl, normalizeRaw, normalizeRawRecords, duplicateConfidence } from '../services/core/normalization.mjs';
import { fixtureRecords, memoryRepository } from './fixtures/discovery-helper.mjs';

test('seven fixture records collapse to four canonical jobs, retaining seven source links', async () => {
  const records = await fixtureRecords();
  const repository = memoryRepository();
  const first = await normalizeRawRecords({ records, repository });
  assert.equal(first.errors.length, 0);
  assert.equal(first.raw_count, 7);
  assert.equal(first.canonical_count, 4);
  assert.equal(first.new_job_ids.length, 4);
  assert.equal(repository.jobs.size, 4);
  assert.equal(repository.links.size, 7);
  const python = [...repository.jobs.values()].find(job => job.title === 'Junior Python Developer');
  assert.equal(python.application_url, 'https://jobs.lever.co/fixture-software/python-201/apply');
  const robotics = [...repository.jobs.values()].find(job => job.title === 'Robotics Research Engineer');
  assert.equal(robotics.work_mode, 'HYBRID');
  assert.equal(robotics.availability_status, 'OPEN');
  assert.equal(repository.links.get('fixture-greenhouse:101'), repository.links.get('fixture-rss:rss-101'));
  const companies = [...repository.jobs.values()].filter(job => job.title === 'Junior Mechanical Engineer').map(job => job.company);
  assert.deepEqual(new Set(companies), new Set(['Fixture Engineering', 'Fixture Other']));
  const ids = [...repository.jobs.keys()].sort();
  const second = await normalizeRawRecords({ records, repository });
  assert.deepEqual(second.new_job_ids, []);
  assert.equal(repository.jobs.size, 4);
  assert.equal(repository.links.size, 7);
  assert.deepEqual([...repository.jobs.keys()].sort(), ids);
});

test('tracking stripped while meaningful query IDs retained and HTML decoded', async () => {
  assert.equal(canonicalizeUrl('https://CAREERS.example/job/?utm_source=mail&gh_jid=100&gclid=abc#apply'), 'https://careers.example/job?gh_jid=100');
  assert.notEqual(canonicalizeUrl('https://careers.example/?gh_jid=100'), canonicalizeUrl('https://careers.example/?gh_jid=101'));
  const raw = (await fixtureRecords())[0];
  raw.raw_payload.content = '&amp;lt;p&amp;gt;CAD &amp;amp; Python&amp;lt;/p&amp;gt;<script>bad()</script>';
  const job = normalizeRaw(raw);
  assert.equal(job.description_text, 'CAD & Python');
});

test('different ATS IDs and low-information same-title jobs do not merge', async () => {
  const first = normalizeRaw((await fixtureRecords())[0]);
  const other = { ...first, canonical_url: first.canonical_url.replace('101', '999'), ats_identity: first.ats_identity.replace('101', '999') };
  assert.equal(duplicateConfidence(first, other), null);
  const lowInfo = { ...first, description_text: '', ats_identity: null };
  assert.equal(duplicateConfidence(lowInfo, { ...lowInfo, canonical_url: 'https://other.example/jobs/2' }), null);
  assert.equal(duplicateConfidence(first, { ...first, profile: 'real' }), null);
});

test('expired posting is CLOSED and absent work mode remains UNKNOWN', async () => {
  const raw = (await fixtureRecords())[0];
  raw.raw_payload.validThrough = '2026-10-01';
  const job = normalizeRaw(raw, { now: '2026-10-03T00:00:00Z' });
  assert.equal(job.availability_status, 'CLOSED');
  assert.equal(job.valid_through, '2026-10-01T00:00:00.000Z');
  assert.equal(job.work_mode, 'UNKNOWN');
  assert.equal(job.salary, null);
});
