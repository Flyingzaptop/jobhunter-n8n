import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { Repository } from '../services/core/repository.mjs';
import { createCore } from '../services/core/server.mjs';
import { fixtureRecords } from '../tests/fixtures/discovery-helper.mjs';
import { bootstrapN8n, importWorkflow, n8nCli } from './n8n-bootstrap.mjs';

export function extractExecution(stdout) {
  for (let start = stdout.indexOf('{'); start >= 0; start = stdout.indexOf('{', start + 1)) {
    let depth = 0, quoted = false, escaped = false;
    for (let end = start; end < stdout.length; end++) {
      const char = stdout[end];
      if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
      if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try { const value = JSON.parse(stdout.slice(start, end + 1)); if (value.data?.resultData) return value; } catch {}
        break;
      }
    }
  }
  throw new Error('No n8n execution result JSON found');
}

export async function executeFixtureStage(number, { body = number === 1 ? { fixture: true } : {}, port = 3000, timeoutMs = 300_000 } = {}) {
  const names = ['discovery', 'normalize-dedupe', 'fit-analysis', 'cv-factory', 'application-hitl', 'reporting-ledger'];
  if (!names[number - 1]) throw new Error('Unsupported workflow stage');
  const filename = `WF-${String(number).padStart(2, '0')}-${names[number - 1]}.json`;
  const workflow = JSON.parse(await readFile(`n8n/workflows/${filename}`, 'utf8'));
  workflow.id = `WF0${number}Fixture`;
  workflow.name = `Stage ${number} isolated fixture acceptance`;
  workflow.nodes = workflow.nodes.filter(node => ['n8n-nodes-base.manualTrigger', 'n8n-nodes-base.httpRequest'].includes(node.type));
  workflow.connections = { 'Manual Trigger': { main: [[{ node: `Execute Stage ${number}`, type: 'main', index: 0 }]] } };
  workflow.settings.saveDataSuccessExecution = 'all';
  const action = workflow.nodes.find(node => node.type === 'n8n-nodes-base.httpRequest');
  action.parameters.url = `http://127.0.0.1:${port}/stages/${number}`;
  action.parameters.jsonBody = JSON.stringify(body);
  action.parameters.options = { ...action.parameters.options, timeout: timeoutMs };
  await importWorkflow(workflow);
  const output = await n8nCli(['execute', `--id=${workflow.id}`, '--rawOutput'], {
    timeoutMs,
    env: { N8N_LOG_LEVEL: 'info', N8N_RUNNERS_BROKER_PORT: String(5800 + number) },
  });
  const execution = extractExecution(output.stdout);
  assert.equal(execution.data.resultData.error, undefined, 'n8n workflow error');
  const result = execution.data.resultData.runData[`Execute Stage ${number}`][0].data.main[0][0].json;
  assert.equal(result.ok, true);
  const audit = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await audit.connect();
  let executionId;
  try {
    const row = (await audit.query('SELECT id,status,mode FROM n8n.execution_entity WHERE "workflowId"=$1 ORDER BY "startedAt" DESC LIMIT 1', [workflow.id])).rows[0];
    assert.equal(row?.status, 'success', 'persisted n8n execution must succeed');
    assert.equal(row?.mode, 'cli');
    executionId = row.id;
  } finally { await audit.end(); }
  return { execution_id: executionId, workflow_id: workflow.id,
    status: execution.status ?? 'success', stage_result: result.result };
}

export async function isolatedStageTest(number, { bootstrap = true } = {}) {
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  const schema = `stage12_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const connection = new URL(process.env.DATABASE_URL);
  connection.searchParams.set('options', `-csearch_path=${schema}`);
  const repository = new Repository(connection.href);
  const core = createCore({ repository, token: process.env.CORE_SERVICE_TOKEN, port: 3000, testMode: true });
  let report;
  try {
    await core.start();
    if (bootstrap) await bootstrapN8n();
    const discovery = await executeFixtureStage(1);
    const raw = await repository.listRaw();
    assert.equal(raw.length, 7);
    assert.equal(new Set(raw.map(row => row.adapter)).size, 3);
    const expected = await fixtureRecords();
    for (const fixture of expected) {
      const saved = raw.find(row => row.source_name === fixture.source_name && row.source_item_id === fixture.source_item_id);
      for (const key of Object.keys(fixture)) assert.deepEqual(saved[key], fixture[key]);
    }
    report = { stage: number, status: 'PASS', execution_engine: 'real_n8n_cli', persistence: 'PostgreSQL',
      isolated_schema: schema, raw_count: raw.length, source_formats: 3, n8n_discovery: discovery, application_actions: 0 };
    if (number === 2) {
      const normalization = await executeFixtureStage(2);
      const jobs = await repository.listCanonicalJobs();
      assert.equal(jobs.length, 4);
      const sources = (await repository.pool.query('SELECT * FROM job_sources')).rows;
      assert.equal(sources.length, 7);
      const shared = sources.filter(source => /jobs\/101/.test(source.source_url));
      assert.equal(new Set(shared.map(source => source.job_id)).size, 1);
      assert.equal(jobs.filter(job => job.title === 'Junior Mechanical Engineer').length, 2);
      const rerun = await executeFixtureStage(2);
      assert.equal(rerun.stage_result.new_job_ids.length, 0);
      assert.equal((await repository.listCanonicalJobs()).length, 4);
      assert.equal((await repository.pool.query('SELECT COUNT(*)::int count FROM job_sources')).rows[0].count, 7);
      report = { ...report, canonical_count: 4, source_links: 7, idempotent: true, n8n_normalization: normalization, n8n_rerun: rerun };
    }
    assert.equal((await repository.pool.query('SELECT COUNT(*)::int count FROM applications')).rows[0].count, 0);
  } catch (error) {
    report = { stage: number, status: 'FAIL', error: error.message, isolated_schema: schema };
    throw error;
  } finally {
    await mkdir('tests/results', { recursive: true });
    if (report) await writeFile(`tests/results/stage${number}.json`, JSON.stringify(report, null, 2) + '\n');
    if (core.server.listening) await core.stop(); else await repository.close();
    await admin.end();
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await isolatedStageTest(1, { bootstrap: !process.argv.includes('--skip-bootstrap') });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
