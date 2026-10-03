import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockBoard } from '../services/mock-job-board/server.mjs';
import { discoverSources } from '../services/core/discovery.mjs';
import { normalizeRawRecords } from '../services/core/normalization.mjs';
import { memoryRepository } from './fixtures/discovery-helper.mjs';

test('Stage 7 JSON and RSS routes expose 21 raw discoveries of 10 jobs without application actions', async () => {
  const board = createMockBoard({ port: 0, testMode: false });
  await board.listen();
  try {
    const base = `http://127.0.0.1:${board.server.address().port}`;
    const records = [];
    const sources = [
      { name: 'stage7-json', adapter: 'mock', profile: 'mock', enabled: true, allow_local_mock: true, url: `${base}/api/jobs`, rate_limit_ms: 250 },
      { name: 'stage7-rss', adapter: 'rss', profile: 'mock', enabled: true, allow_local_mock: true, url: `${base}/rss`, rate_limit_ms: 250 },
    ];
    const discovered = await discoverSources({ sources, repository: { async insertRaw(raw) {
      const row = { ...raw, raw_id: String(records.length + 1) }; records.push(row); return row;
    } } });
    assert.equal(discovered.discovered, 21);
    assert.deepEqual(discovered.errors, []);
    assert.equal(records.filter(raw => raw.source_name === 'stage7-rss').length, 10);
    assert.equal(records.filter(raw => raw.source_name === 'stage7-json').length, 11);
    const repository = memoryRepository();
    // Mirror PostgreSQL job_sources identity, which preserves distinct source
    // URLs even when a publisher repeats its own item ID.
    repository.upsertCanonicalJob = async (job, { source }) => {
      const is_new = !repository.jobs.has(job.job_id);
      repository.jobs.set(job.job_id, structuredClone(job));
      repository.links.set(`${job.job_id}:${source.source_name}:${source.source_url}`, job.job_id);
      return { job_id: job.job_id, is_new };
    };
    const normalized = await normalizeRawRecords({ records, repository });
    assert.equal(normalized.canonical_count, 10);
    assert.equal(normalized.new_job_ids.length, 10);
    assert.deepEqual(normalized.errors, []);
    const target = [...repository.jobs.values()].find(job => job.title === 'Mechanical R&D Engineer');
    assert.ok(target);
    assert.equal([...repository.links.values()].filter(jobId => jobId === target.job_id).length, 3,
      'Two JSON source variants and the RSS listing must reference the same canonical target');
    assert.equal(repository.links.size, 21);
    const repeated = await normalizeRawRecords({ records, repository });
    assert.equal(repeated.canonical_count, 10);
    assert.equal(repeated.new_job_ids.length, 0);
    assert.equal(repository.links.size, 21);
    assert.equal(board.drafts.size, 0);
    assert.equal(board.submissions.size, 0);
  } finally { await board.close(); }
});
