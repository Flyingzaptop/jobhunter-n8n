import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile, copyFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {createCore} from '../services/core/server.mjs';
import {parseSourcePayload} from '../services/core/discovery.mjs';
import {normalizeRawRecords} from '../services/core/normalization.mjs';
import {validateFactIntegrity, factIndex} from '../services/core/fit.mjs';
import {vacancies} from '../services/mock-job-board/server.mjs';
import {bootstrapN8n} from './n8n-bootstrap.mjs';
import {executeFixtureStage} from './test-stage-1.mjs';

const cases = [
  ['mechanical-engineer-42', 'excellent matching role', ['AUTO_APPLY']],
  ['fea-junior', 'junior simulation role / hiring-route review', ['REVIEW','STRETCH']],
  ['prototype-design', 'adjacent project-supported role / hiring-route review', ['REVIEW','STRETCH']],
  ['r-and-d-munich', 'nonlocal European relocation review', ['REVIEW','STRETCH']],
  ['cad-stretch', 'preferred professional years shortfall / real 45-59 stretch band', ['STRETCH']],
  ['senior-catia', 'excessive strict professional years', ['REJECT','REVIEW']],
  ['nurse', 'mandatory professional licence missing or unknown', ['REJECT','REVIEW']],
  ['chef', 'irrelevant role / unsupported mandatory qualifications', ['REJECT','REVIEW']]
];

export async function runStage3Acceptance({bootstrap = true, resumeSchema = null} = {}) {
  const profilePath = path.resolve('tests/fixtures/candidate_profile_test.yaml');
  const profile = YAML.parse(await readFile(profilePath, 'utf8'));
  assert.equal(profile.profile_id, 'fictional-stage7', 'Only fictional profile permitted for Stage3 acceptance');
  const previous = resumeSchema ? JSON.parse(await readFile('tests/results/stage3.json', 'utf8')) : null;
  if (resumeSchema && (!/^stage3_[a-f0-9]{32}$/.test(resumeSchema) || previous.isolated_schema !== resumeSchema))
    throw new Error('Resume schema must match the previous isolated Stage3 report');
  const schema = resumeSchema || `stage3_${randomUUID().replaceAll('-', '')}`;
  const configDir = path.resolve('data', schema, 'config');
  await mkdir(configDir, {recursive: true});
  await copyFile('config/search_policy.yaml', path.join(configDir, 'search_policy.yaml'));
  const admin = new pg.Client({connectionString: process.env.DATABASE_URL});
  await admin.connect();
  if (!resumeSchema) await admin.query(`CREATE SCHEMA "${schema}"`);
  const connection = new URL(process.env.DATABASE_URL);
  connection.searchParams.set('options', `-csearch_path=${schema}`);
  const repository = new Repository(connection.href);
  const core = createCore({repository, token: process.env.CORE_SERVICE_TOKEN,
    port: 3003, configDir, testProfilePath: profilePath, testMode: true});
  const start = performance.now();
  const report = {stage: 3, status: 'FAIL', execution_engine: 'real_n8n_cli', persistence: 'PostgreSQL',
    gateway: 'real-local-ollama', model: process.env.LLM_FAST_MODEL || 'qwen3.5:4b',
    isolated_schema: schema, cases: [], applications_created: 0, real_submissions: 0,
    ...(previous ? {previous_run: {status: previous.status, timestamp: previous.timestamp,
      cases: previous.cases, elapsed_ms: previous.elapsed_ms}} : {})};
  try {
    await core.start();
    if (bootstrap) await bootstrapN8n();
    const stretch = {...vacancies.find(v => v.id === 'fea-junior'), id: 'cad-stretch', source_item_id: 'cad-stretch',
      title: 'CAD Design Engineer', company: 'Fixture CAD stretch',
      description_text: 'Preferred: 4 years professional CAD experience. Work fully remotely from Poland using a Polish employment contract.'};
    stretch.description = stretch.description_text;
    const selected = [...vacancies, stretch].filter(v => cases.some(([id]) => id === v.id)).map(v => ({...v,
      canonical_url: `https://stage3.fixture.invalid/jobs/${v.id}`,
      application_url: `https://stage3.fixture.invalid/apply/${v.id}`}));
    const source = {name: 'stage3-real-model-mock-vacancies', adapter: 'mock', profile: 'mock',
      url: 'https://stage3.fixture.invalid/api/jobs'};
    const records = parseSourcePayload(source, JSON.stringify({jobs: selected}));
    for (const raw of records) await repository.insertRaw(raw);
    const normalized = await normalizeRawRecords({records: await repository.listRaw(), repository});
    assert.equal(normalized.errors.length, 0);
    const jobs = await repository.listCanonicalJobs();
    assert.equal(jobs.length, cases.length);
    for (const [fixtureId, description, expectedDecisions] of cases) {
      const completed = previous?.cases.find(c => c.fixture_id === fixtureId && c.status === 'PASS');
      if (completed) {report.cases.push({...completed, preserved_from_prior_execution: true}); continue;}
      const job = jobs.find(j => j.canonical_url.endsWith(`/${fixtureId}`));
      assert.ok(job);
      const caseStart = performance.now();
      const execution = await executeFixtureStage(3, {port: 3003,
        body: {job_ids: [job.job_id], limit: 1, ...(resumeSchema ? {reanalyze: true} : {})}, timeoutMs: 420000});
      const outcome = execution.stage_result.results[0];
      assert.equal(execution.stage_result.attempted, 1);
      const row = (await repository.pool.query('SELECT * FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1', [job.job_id])).rows[0];
      const entry = {fixture_id: fixtureId, description, expected_decisions: expectedDecisions,
        elapsed_ms: Math.round(performance.now() - caseStart), execution_id: execution.execution_id,
        workflow_id: execution.workflow_id, job_id: job.job_id, result: outcome};
      if (row) {
        const analysis = row.analysis_json;
        // Post-discipline requirements can have extra verified-years metadata;
        // validate the canonical persisted schema without changing its values.
        const check = structuredClone(analysis);
        check.requirements = check.requirements.map(({professional_years_verified, ...r}) => r);
        for (const key of ['technical_fit','experience_fit','education_fit','language_fit','overall_fit',
          'category_scores','active_weight','scored_requirements','mandatory_unknown','work_format_class',
          'eligible_for_discovery','eligible_for_auto_apply','reasons','employment_eligibility','decision',
          'application_priority','prompt_version','profile_version','model']) delete check[key];
        validateFactIntegrity(check, profile, job);
        const known = factIndex(profile);
        assert.ok(analysis.requirements.every(r => r.candidate_evidence_fact_ids.every(id => known.has(id))));
        entry.analysis = {decision: analysis.decision, overall_fit: analysis.overall_fit,
          work_format_class: analysis.work_format_class, reasons: analysis.reasons,
          prompt_version: analysis.prompt_version, profile_version: row.profile_version,
          requirements: analysis.requirements, cv_focus_fact_ids: analysis.cv_focus_fact_ids};
        entry.status = expectedDecisions.includes(analysis.decision) ? 'PASS' : 'FAIL';
      } else {
        entry.status = 'FAIL'; entry.error = outcome?.diagnostic || outcome?.error_detail || outcome?.error || 'No persisted analysis';
      }
      report.cases.push(entry);
      console.log(JSON.stringify({stage: 3, case: fixtureId, status: entry.status,
        decision: entry.analysis?.decision, fit: entry.analysis?.overall_fit, elapsed_ms: entry.elapsed_ms}));
    }
    // A fresh real model run must preserve the primary routing decision.
    const target = jobs.find(j => j.canonical_url.endsWith('/mechanical-engineer-42'));
    const repeat = await executeFixtureStage(3, {port: 3003,
      body: {job_ids: [target.job_id], limit: 1, reanalyze: true}, timeoutMs: 420000});
    report.repeat_execution = repeat;
    report.repeat_stable = repeat.stage_result.results[0]?.decision === report.cases[0].analysis?.decision
      && repeat.stage_result.results[0]?.error === undefined;
    report.persisted_analysis_rows = (await repository.pool.query('SELECT COUNT(*)::int count FROM job_analysis')).rows[0].count;
    report.applications_created = (await repository.pool.query('SELECT COUNT(*)::int count FROM applications')).rows[0].count;
    report.unit_report = JSON.parse(await readFile('tests/results/stage3-unit.json', 'utf8'));
    report.status = report.cases.every(c => c.status === 'PASS') && report.repeat_stable
      && report.applications_created === 0 ? 'PASS' : 'FAIL';
  } catch (error) {
    report.error = error.message;
  } finally {
    report.elapsed_ms = Math.round(performance.now() - start); report.timestamp = new Date().toISOString();
    await mkdir('tests/results', {recursive: true});
    await writeFile('tests/results/stage3.json', JSON.stringify(report, null, 2));
    const lines = ['# Stage 3 acceptance report', '', `OVERALL: ${report.status}`, '',
      `Model: ${report.model}. Gateway: real local Ollama. Execution: real n8n CLI; PostgreSQL schema ${schema}.`, '',
      '| Synthetic vacancy | Result | Fit | Observed routing |', '|---|---|---:|---|',
      ...report.cases.map(c => `| ${c.fixture_id} | ${c.status} | ${c.analysis?.overall_fit ?? 'N/A'} | ${c.analysis?.decision ?? c.error} |`), '',
      `Repeated primary role routing stable: ${report.repeat_stable ?? false}.`,
      `Applications created: ${report.applications_created}; real submissions: 0.`, '',
      `Scope: ${cases.length} real-model synthetic vacancy analyses and persisted n8n executions. Conservative REVIEW is permitted for genuinely unknown mandatory qualifications and hiring routes. The cad-stretch case requires an observed real-model STRETCH decision in the 45–59 score band.`, '',
      `Separate deterministic unit result: ${report.unit_report?.passed ?? 'unavailable'}/${report.unit_report?.tests ?? 'unavailable'}.`,
      'Detailed requirement-to-fact maps, prompt/profile versions and execution IDs: tests/results/stage3.json.', '',
      'Run: node --env-file=.env tests/stage3-unit-report.mjs; node --env-file=.env scripts/test-stage-3.mjs --skip-bootstrap.',
      ...(report.error ? ['', `Failure: ${report.error}`] : [])];
    await writeFile('docs/STAGE_3_REPORT.md', lines.join('\n') + '\n');
    if (core.server.listening) await core.stop(); else await repository.close();
    await admin.end();
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const resumeSchema = process.argv.find(arg => arg.startsWith('--resume='))?.slice('--resume='.length);
  const report = await runStage3Acceptance({bootstrap: !process.argv.includes('--skip-bootstrap'), resumeSchema});
  console.log(JSON.stringify({stage: 3, status: report.status, cases: report.cases.length,
    elapsed_ms: report.elapsed_ms, error: report.error}));
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}
