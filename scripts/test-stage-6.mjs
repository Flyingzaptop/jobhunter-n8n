import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { Repository } from '../services/core/repository.mjs';
import { createCore } from '../services/core/server.mjs';
import { bootstrapN8n } from './n8n-bootstrap.mjs';
import { executeFixtureStage } from './test-stage-1.mjs';

const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
const schema = `stage6_${randomUUID().replaceAll('-', '')}`;
await admin.query(`CREATE SCHEMA "${schema}"`);
const connection = new URL(process.env.DATABASE_URL);
connection.searchParams.set('options', `-csearch_path=${schema}`);
const repository = new Repository(connection.href);
const reportDir = path.resolve('data/report-fixtures', schema);
const messages = [];
const core = createCore({ repository, token: process.env.CORE_SERVICE_TOKEN, port: 3006, testMode: true,
  reportOutputDir: reportDir, telegramAdapter: { async send(message) { messages.push(message); return { ok: true, test_transport: true }; } } });
let report;
try {
  await core.start();
  if (!process.argv.includes('--skip-bootstrap')) await bootstrapN8n();
  const jobIds = [];
  for (let index = 0; index < 30; index++) await repository.insertRaw({ source_name: 'stage6-fixture', source_item_id: String(index),
    source_url: `https://stage6.example.invalid/discovery/${index}`, title_hint: `Fixture ${index}`, company_hint: 'Fixture',
    location_hint: 'Europe', raw_payload: {}, profile: 'mock' });
  for (let index = 0; index < 24; index++) {
    const jobId = randomUUID(); jobIds.push(jobId);
    await repository.upsertCanonicalJob({ job_id: jobId, canonical_url: `https://stage6.example.invalid/job/${index}`,
      application_url: `https://stage6.example.invalid/apply/${index}`, company: 'Stage6 Fixture Company', title: `Fixture Role ${index}`,
      description_text: 'Artificial reporting fixture.', location: 'Europe', work_mode: 'UNKNOWN', availability_status: 'OPEN', profile: 'mock' },
    { source: { source_name: 'stage6-fixture', source_item_id: String(index), source_url: `https://stage6.example.invalid/discovery/${index}` } });
    await repository.saveAnalysis(jobId, { decision: index < 4 ? 'AUTO_APPLY' : index < 6 ? 'REVIEW' : index === 6 ? 'STRETCH' : 'REJECT',
      overall_fit: index < 7 ? 80 : 20, model: 'seeded-report-fixture' });
  }
  const statuses = ['SUBMITTED', 'SUBMITTED', 'SUBMITTED', 'SUBMITTED', 'NEEDS_USER', 'FAILED', 'SKIPPED'];
  const fixtureSubmittedAt = new Date().toISOString();
  for (const [index, status] of statuses.entries()) {
    const id = randomUUID();
    await repository.pool.query(`INSERT INTO applications(application_id,candidate_profile_id,job_id,status,dry_run,confirmation_id,submitted_at,skip_reason,failure_reason) VALUES($1,$2,$3,$4,true,$5,$6,$7,$8)`,
      [id, 'fictional-stage6', jobIds[index], status, status === 'SUBMITTED' ? `FIXTURE-CONF-${index}` : null,
        status === 'SUBMITTED' ? fixtureSubmittedAt : null, status === 'SKIPPED' ? 'JOB_CLOSED' : null,
        status === 'FAILED' ? 'FIXTURE_FAILURE' : null]);
    if (status === 'SUBMITTED') await repository.pool.query('INSERT INTO application_outcomes(outcome_id,application_id,outcome_status,source,notes) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), id, 'NO_RESPONSE', 'fixture', 'Artificial status; no browser submission occurred.']);
  }
  const first = await executeFixtureStage(6, { port: 3006 });
  const summary = first.stage_result;
  assert.deepEqual({ discovered: summary.discovered, unique: summary.unique, analyzed: summary.analyzed,
    submitted: summary.submitted, awaiting_user: summary.awaiting_user, failed: summary.failed, skipped: summary.statuses.SKIPPED },
  { discovered: 30, unique: 24, analyzed: 24, submitted: 4, awaiting_user: 1, failed: 1, skipped: 1 });
  const suitable = summary.bands.filter(band => band.decision !== 'REJECT').reduce((total, band) => total + band.count, 0);
  assert.equal(suitable, 7);
  assert.equal(summary.suitable, 7);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.total, 7);
  assert.deepEqual({discovered:summary.daily.discovered,unique:summary.daily.unique,analyzed:summary.daily.analyzed,
    suitable:summary.daily.suitable,submitted:summary.daily.submitted,awaiting_user:summary.daily.awaiting_user,
    failed:summary.daily.failed,skipped:summary.daily.skipped},
  {discovered:30,unique:24,analyzed:24,suitable:7,submitted:4,awaiting_user:1,failed:1,skipped:1});
  assert.equal(summary.scope, 'cumulative');
  assert.equal(summary.weekly.funnel.submitted, 4);
  assert.equal(summary.weekly.funnel.no_response_still_pending, 4);
  assert.equal(summary.weekly.breakdowns.fit_band[0].value, 'AUTO_APPLY');
  assert.equal(messages.length, 1);
  for (const text of ['Discovered: 30', 'Unique: 24', 'Analyzed: 24', 'Suitable: 7', 'AUTO_APPLY: 4', 'REVIEW: 2', 'STRETCH: 1', 'REJECT: 17', 'Submitted: 4', 'Awaiting user: 1', 'Failed: 1', 'Skipped: 1']) {
    assert.ok(messages[0].includes(text), `Missing Telegram summary metric ${text}`);
  }
  const csvPath = path.join(reportDir, 'applications_log.csv');
  const ledgerPath = path.join(reportDir, 'APPLICATIONS_LOG.md');
  const csv = await readFile(csvPath, 'utf8');
  const ledger = await readFile(ledgerPath, 'utf8');
  assert.equal(csv.trim().split('\n').length, 8);
  assert.ok(csv.includes('work_format_class,office_location,onsite_frequency,employment_route,work_from_poland_allowed,relocation_required'));
  assert.equal((ledger.match(/FIXTURE-CONF-/g) ?? []).length, 4);
  assert.equal(summary.outcomes.find(row => row.outcome_status === 'NO_RESPONSE').count, 4);
  const second = await executeFixtureStage(6, { port: 3006 });
  const { reconciliation: firstReconciliation, ...firstMetrics } = summary;
  const { reconciliation: secondReconciliation, ...secondMetrics } = second.stage_result;
  assert.deepEqual(secondMetrics, firstMetrics);
  assert.deepEqual(secondReconciliation.actions, firstReconciliation.actions);
  assert.equal(firstReconciliation.automatic_submissions, 0);
  assert.equal(secondReconciliation.automatic_submissions, 0);
  assert.equal(secondReconciliation.new_events, 0, 'Reconciliation must not repeat unchanged evidence events');
  assert.equal(await readFile(csvPath, 'utf8'), csv);
  assert.equal(await readFile(ledgerPath, 'utf8'), ledger);
  assert.equal(messages.length, 2);
  assert.equal(messages[1], messages[0]);
  assert.equal((await repository.pool.query('SELECT COUNT(*)::int count FROM applications')).rows[0].count, 7);
  report = { stage: 6, module_test_status: 'PASS', acceptance_status: 'CONDITIONAL_PENDING_STAGE5',
    execution_engine: 'real_n8n_cli', persistence: 'PostgreSQL', schema, execution_id: first.execution_id, rerun_execution_id: second.execution_id,
    summary, suitable, ledger_rows: 4, csv_rows: 7, idempotent: true, output_dir: reportDir,
    reconciliation_rerun_new_events: secondReconciliation.new_events,
    daily_period: summary.daily.date, weekly_period: summary.weekly.period,
    telegram_summary_text: messages[0], telegram_transport: 'injected_capture_only', real_telegram_delivery_verified: false,
    application_status_origin: 'seeded_fixture', real_application_submissions: 0,
    limitations: ['Synthetic submitted statuses test reporting only; no upstream Stage 5 browser submission is proven.',
      'Telegram content is validated through an injected transport; real bot delivery is not exercised.'] };
} catch (error) {
  report = { stage: 6, module_test_status: 'FAIL', error: error.message, schema };
  throw error;
} finally {
  await mkdir('tests/results', { recursive: true });
  await writeFile('tests/results/stage6.json', JSON.stringify(report, null, 2) + '\n');
  if (core.server.listening) await core.stop(); else await repository.close();
  await admin.end();
}
process.stdout.write(`${JSON.stringify(report)}\n`);
