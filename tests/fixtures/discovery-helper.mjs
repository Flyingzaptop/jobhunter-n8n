import { readFile } from 'node:fs/promises';
import { parseSourcePayload } from '../../services/core/discovery.mjs';
export async function fixtureRecords() {
  const configs = [
    ['greenhouse', 'Fixture Engineering', 'fixture-engineering', 'discovery-greenhouse.json'],
    ['lever', 'Fixture Software', 'fixture-software', 'discovery-lever.json'],
    ['rss', 'Fixture Engineering', null, 'discovery-rss.xml'],
  ];
  const rows = [];
  for (const [adapter, company, board, filename] of configs) {
    const source = { name: `fixture-${adapter}`, adapter, company, board, profile: 'mock', url: 'https://fixture.example/feed' };
    const payload = await readFile(new URL(filename, import.meta.url), 'utf8');
    const parsed = parseSourcePayload(source, payload);
    // Second Lever posting is intentionally another company with identical title and description.
    if (adapter === 'lever') parsed[1].company_hint = 'Fixture Other';
    rows.push(...parsed);
  }
  return rows;
}
export function memoryRepository() {
  const raw = new Map(), jobs = new Map(), links = new Map();
  return {
    raw, jobs, links,
    async insertRaw(record) {
      const key = `${record.source_name}:${record.source_item_id}`;
      const row = { ...structuredClone(record), raw_id: key }; raw.set(key, row); return row;
    },
    async listCanonicalJobs() { return [...jobs.values()].map(row => structuredClone(row)); },
    async upsertCanonicalJob(job, { source }) {
      const is_new = !jobs.has(job.job_id);
      jobs.set(job.job_id, structuredClone(job));
      links.set(`${source.source_name}:${source.source_item_id}`, job.job_id);
      return { job_id: job.job_id, is_new };
    },
  };
}
