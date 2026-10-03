import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { Repository } from '../services/core/repository.mjs';
import { discoverSources, sourceEndpoint } from '../services/core/discovery.mjs';
import { normalizeRawRecords } from '../services/core/normalization.mjs';

export async function runDiscoverySmoke({ repository, registryPath = 'config/source_registry.yaml', fetchOnly = false } = {}) {
  const registry = YAML.parse(await readFile(registryPath, 'utf8'));
  const sources = registry.sources.filter(source => source.enabled !== false && source.profile === 'real')
    .map(source => ({ ...registry.defaults, ...source }));
  const records = [];
  const runId = randomUUID();
  const sink = {
    async insertRaw(record) {
      const raw = { ...record, ingestion_run_id: runId };
      const saved = repository ? await repository.insertRaw(raw) : { ...raw, raw_id: randomUUID() };
      records.push({ ...raw, raw_id: saved.raw_id });
      return saved;
    },
  };
  if (!fetchOnly && !repository) throw new Error('POSTGRES_REPOSITORY_REQUIRED');
  const started = new Date().toISOString();
  const discovered = await discoverSources({ sources, repository: sink,
    logger: item => process.stdout.write(`${JSON.stringify(item)}\n`) });
  const normalization = repository ? await normalizeRawRecords({ records, repository }) : null;
  const adapters = [...new Set(records.map(raw => raw.adapter))];
  const successful = adapters.length >= 3 && discovered.errors.length === 0 && (!normalization || normalization.errors.length === 0);
  return {
    run_id: runId, started_at: started, completed_at: new Date().toISOString(),
    status: successful ? (repository ? 'DISCOVERY_NORMALIZATION_PASS' : 'FETCH_ONLY_PASS') : 'FAIL',
    scope: repository ? 'real_public_feeds_with_postgres_normalization' : 'real_public_feed_fetch_only',
    stage7_executed: false, full_pipeline_pass: false, live_submit: false,
    application_actions: 0, application_submission_requests: 0,
    sources: sources.map(source => ({ source_name: source.name, adapter: source.adapter,
      feed_url: sourceEndpoint(source), discovered: records.filter(raw => raw.source_name === source.name).length,
      sampled_urls: records.filter(raw => raw.source_name === source.name).slice(0, 3).map(raw => raw.source_url),
      error: discovered.errors.find(error => error.source_name === source.name)?.error ?? null })),
    discovered: discovered.discovered, persisted_raw_records: repository ? records.length : 0,
    adapters_tested: adapters, errors: discovered.errors, normalization,
    limitations: [
      'This measures configured public ATS feeds only; it does not prove search coverage across all role families or countries.',
      'No n8n execution, LLM fit, CV generation, browser filling or application submission is exercised.',
      'Full Stage 7 acceptance and subsequent production-readiness report remain separate gates.',
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fetchOnly = process.argv.includes('--fetch-only');
  const repo = fetchOnly ? null : new Repository();
  try {
    if (repo) await repo.migrate();
    const report = await runDiscoverySmoke({ repository: repo, fetchOnly });
    await mkdir('tests/results', { recursive: true });
    await writeFile('tests/results/real-discovery-smoke.json', JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(`${JSON.stringify({ status: report.status, discovered: report.discovered, persisted_raw_records: report.persisted_raw_records })}\n`);
    if (report.status === 'FAIL') process.exitCode = 1;
  } finally { await repo?.close(); }
}
