import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import YAML from 'yaml';
import { PDFParse } from 'pdf-parse';
import { Repository } from '../services/core/repository.mjs';
import { createCore } from '../services/core/server.mjs';
import { bootstrapN8n } from './n8n-bootstrap.mjs';
import { executeFixtureStage } from './test-stage-1.mjs';

const execFileAsync = promisify(execFile);
const profilePath = 'tests/fixtures/candidate_profile_test.yaml';
const profile = YAML.parse(await readFile(profilePath, 'utf8'));
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
const schema = `stage4_${randomUUID().replaceAll('-', '')}`;
await admin.query(`CREATE SCHEMA "${schema}"`);
const connection = new URL(process.env.DATABASE_URL);
connection.searchParams.set('options', `-csearch_path=${schema}`);
const repository = new Repository(connection.href);
const core = createCore({ repository, token: process.env.CORE_SERVICE_TOKEN, port: 3004, testMode: true, testProfilePath: profilePath });
let report;
const extractPdf = async file => {
  const parser = new PDFParse({ data: await readFile(file) });
  try { return await parser.getText(); } finally { await parser.destroy(); }
};
try {
  await core.start();
  if (!process.argv.includes('--skip-bootstrap')) await bootstrapN8n();
  const specs = [
    { title: 'Junior Mechanical Design Engineer', focus: 'exp_design', provenance: 'PROFESSIONAL' },
    { title: 'Graduate Simulation Engineer', focus: 'project_mech', provenance: 'ACADEMIC' },
    { title: 'Junior Python Research Engineer', focus: 'rnd_python', provenance: 'INDEPENDENT_R_AND_D' },
  ];
  const outputs = [];
  for (const spec of specs) {
    const jobId = randomUUID();
    await repository.upsertCanonicalJob({ job_id: jobId, canonical_url: `https://stage4.example.invalid/${jobId}`,
      application_url: `https://stage4.example.invalid/apply/${jobId}`, company: 'Stage4 Fixture Company', title: spec.title,
      location: 'Wrocław, Poland', country: 'PL', work_mode: 'HYBRID', description_text: 'Fixture verified job description.',
      availability_status: 'OPEN', profile: 'mock' }, { source: { source_name: 'stage4-seeded', source_item_id: jobId, source_url: `https://stage4.example.invalid/${jobId}` } });
    await repository.saveAnalysis(jobId, { decision: 'REVIEW', overall_fit: 80, model: 'seeded-fixture-analysis',
      prompt_version: 'fixture-v1', profile_version: 'fixture-v1', cv_focus_fact_ids: [spec.focus] });
    const execution = await executeFixtureStage(4, { body: { job_id: jobId }, port: 3004 });
    const manifest = execution.stage_result;
    assert.equal(manifest.qa.pass, true);
    const dir = path.dirname(manifest.pdf_path);
    const document = JSON.parse(await readFile(path.join(dir, 'cv.json'), 'utf8'));
    const parsed = await extractPdf(manifest.pdf_path);
    const fact = [...profile.experience, ...profile.projects].find(fact => fact.id === spec.focus);
    assert.equal(fact.provenance, spec.provenance);
    assert.deepEqual(document.bullets.map(bullet => bullet.source_fact_ids), fact.statements.map(() => [fact.id]));
    assert.deepEqual(document.bullets.map(bullet => bullet.text), fact.statements);
    for (const statement of fact.statements) assert.ok(parsed.text.includes(statement));
    for (const other of [...profile.experience, ...profile.projects].filter(fact => fact.id !== spec.focus)) {
      for (const statement of other.statements) assert.ok(!parsed.text.includes(statement), 'Unselected claims must not enter the CV');
    }
    assert.ok(!/Senior|10 years|PhD|UNKNOWN|TODO|PLACEHOLDER/.test(parsed.text));
    assert.equal(parsed.total, 1);
    const firstHtml = await readFile(manifest.html_path, 'utf8');
    const rerun = await executeFixtureStage(4, { body: { job_id: jobId }, port: 3004 });
    const repeated = await extractPdf(rerun.stage_result.pdf_path);
    assert.equal(repeated.text, parsed.text);
    assert.equal(repeated.total, parsed.total);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'cv.json'), 'utf8')), document);
    assert.equal(await readFile(manifest.html_path, 'utf8'), firstHtml);
    const renderPrefix = path.join(dir, 'qa-page');
    await execFileAsync('pdftoppm', ['-r', '110', '-png', '-singlefile', manifest.pdf_path, renderPrefix], { windowsHide: true });
    outputs.push({ role: spec.title, focus_fact_id: fact.id, provenance: fact.provenance,
      pdf_path: manifest.pdf_path, preview_path: `${renderPrefix}.png`, sha256: rerun.stage_result.sha256,
      page_count: parsed.total, qa: manifest.qa, execution_id: execution.execution_id, rerun_execution_id: rerun.execution_id,
      semantic_reproducibility: true, rendered_text: parsed.text });
  }
  assert.equal(new Set(outputs.map(output => output.rendered_text)).size, 3);
  assert.equal(new Set(outputs.map(output => output.sha256)).size, 3);
  assert.equal((await repository.pool.query('SELECT COUNT(*)::int count FROM cv_versions')).rows[0].count, 6);
  assert.equal((await repository.pool.query('SELECT COUNT(*)::int count FROM applications')).rows[0].count, 0);
  report = { stage: 4, module_test_status: 'PASS', acceptance_status: 'CONDITIONAL_PENDING_STAGE3',
    execution_engine: 'real_n8n_cli', persistence: 'PostgreSQL', schema, analysis_origin: 'seeded_verified_fixture',
    llm_stage3_exercised: false, pdf_count: 3, cv_version_rows: 6, no_application_actions: true,
    output_reproducibility: 'Identical extracted text, HTML and factual JSON on rerun; PDF metadata bytes may vary.',
    visual_review_status: 'RENDERED_AWAITING_REVIEW', outputs: outputs.map(({ rendered_text, ...output }) => output) };
} catch (error) {
  report = { stage: 4, module_test_status: 'FAIL', error: error.message, schema };
  throw error;
} finally {
  await mkdir('tests/results', { recursive: true });
  await writeFile('tests/results/stage4.json', JSON.stringify(report, null, 2) + '\n');
  if (core.server.listening) await core.stop(); else await repository.close();
  await admin.end();
}
process.stdout.write(`${JSON.stringify(report)}\n`);
