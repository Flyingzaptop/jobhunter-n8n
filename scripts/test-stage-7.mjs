import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import YAML from 'yaml';
import { PDFParse } from 'pdf-parse';
import { Repository } from '../services/core/repository.mjs';
import { createCore } from '../services/core/server.mjs';
import { Telegram } from '../services/core/telegram.mjs';
import { BrowserClient } from '../services/core/application.mjs';
import { factIndex, PROMPT_VERSION } from '../services/core/fit.mjs';
import { browserConfig, createBrowserService } from '../services/browser-service/server.mjs';
import { createMockBoard } from '../services/mock-job-board/server.mjs';
import { fixtureHumanCaptcha } from '../services/mock-job-board/test-human-adapter.mjs';
import { bootstrapN8n } from './n8n-bootstrap.mjs';
import { executeFixtureStage } from './test-stage-1.mjs';

const execFileAsync = promisify(execFile);
const digest = value => createHash('sha256').update(value).digest('hex');
const started = new Date().toISOString();
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
const schema = `stage7_${randomUUID().replaceAll('-', '')}`;
await admin.query(`CREATE SCHEMA "${schema}"`);
const connection = new URL(process.env.DATABASE_URL);
connection.searchParams.set('options', `-csearch_path=${schema}`);
const outputRoot = path.resolve('data/test-stage7', schema);
const configDir = path.join(outputRoot, 'config');
await mkdir(configDir, { recursive: true });
const profile = YAML.parse(await readFile('tests/fixtures/candidate_profile_test.yaml', 'utf8'));
profile.onboarding.earliest_start_date = 'UNKNOWN';
const profilePath = path.join(configDir, 'candidate_profile.yaml');
await writeFile(profilePath, YAML.stringify(profile));
await writeFile(path.join(configDir, 'search_policy.yaml'), await readFile('config/search_policy.yaml'));
const baseUrl = 'http://127.0.0.1:3002';
await writeFile(path.join(configDir, 'source_registry.yaml'), YAML.stringify({ version: 1, defaults: { rate_limit_ms: 250 },
  sources: [
    { name: 'stage7-json', adapter: 'mock', profile: 'mock', enabled: true, allow_local_mock: true, url: `${baseUrl}/api/jobs` },
    { name: 'stage7-rss', adapter: 'rss', profile: 'mock', enabled: true, allow_local_mock: true, url: `${baseUrl}/rss` },
  ] }));
const answerMemory = { answers: ['salary_expectation', 'work_arrangement', 'timezone_overlap'].map((key, index) => ({
  key, value: ['10000-12000', 'Remote', '09:00-17:00 Europe/Warsaw'][index], source: 'USER', reusable: true,
  reuse_approved: true, scope: { country: 'PL' },
})) };
await writeFile(path.join(configDir, 'answer_memory.yaml'), YAML.stringify(answerMemory));
const configuration = { ...browserConfig({ BROWSER_SERVICE_TOKEN: process.env.BROWSER_SERVICE_TOKEN,
  ALLOW_MOCK_NETWORK: 'true', ALLOW_MOCK_SUBMIT: 'true', ALLOW_REAL_SUBMIT: 'false', DRY_RUN: 'true',
  ARTIFACT_DIR: path.join(outputRoot, 'cv'), BROWSER_STATE_DIR: path.join(outputRoot, 'browser') }), port: 0 };
const browserService = await createBrowserService(configuration);
const testToken = `isolated-stage7-human-${randomUUID()}`;
const board = createMockBoard({ port: 3002, testMode: true, testToken });
let submitRequests = 0;
board.server.prependListener('request', request => {
  if (request.method === 'POST' && /^\/submit\//.test(request.url)) submitRequests++;
});
let nextMessageId = 700;
const sent = [];
const telegram = new Telegram({ token: 'stage7-fixture-transport', chatId: '70007', fetchImpl: async (url, request) => {
  const method = url.split('/').at(-1);
  const body = request.body instanceof FormData ? null : JSON.parse(request.body);
  const message_id = ++nextMessageId;
  const photo = request.body instanceof FormData ? request.body.get('photo') : null;
  const photoBytes = photo ? Buffer.from(await photo.arrayBuffer()) : null;
  sent.push({ method, message_id, text: body?.text ?? null, caption: request.body instanceof FormData ? request.body.get('caption') : null,
    photo: Boolean(photo), photo_size: photoBytes?.length, photo_sha256: photoBytes ? digest(photoBytes) : null,
    photo_is_png: photoBytes?.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ?? false });
  return { ok: true, json: async () => ({ ok: true, result: { message_id } }) };
} });
let repository = new Repository(connection.href), core, browserClient, report, selectedJob, currentStage, analysisEvidence, unitEvidence;
const executions = [];
// The gateway allows two semantic attempts, each optionally preceded by a
// bounded native context probe. Let those attempts return their own evidence
// rather than timing out n8n first and leaving inference running in the core.
const matchingTimeoutMs = 4 * Number(process.env.LLM_TIMEOUT_MS || 240_000) + 60_000;
const run = async (stage, body = {}) => {
  currentStage = stage;
  const began = Date.now();
  process.stdout.write(`${JSON.stringify({ event: 'stage7_stage_start', stage, analyzed_job_batch: stage === 3 ? executions.filter(e => e.stage === 3).length + 1 : undefined })}\n`);
  const execution = await executeFixtureStage(stage, { body, port: 3007, timeoutMs: stage === 3 ? matchingTimeoutMs : 300_000 });
  executions.push({ stage, duration_ms: Date.now() - began, ...execution });
  process.stdout.write(`${JSON.stringify({ event: 'stage7_stage_done', stage, execution_id: execution.execution_id })}\n`);
  return execution.stage_result;
};
const startCore = async () => {
  core = createCore({ repository, token: process.env.CORE_SERVICE_TOKEN, port: 3007, testMode: true,
    configDir, testProfilePath: profilePath, telegramAdapter: telegram, browserClient, applicationConfig: configuration,
    answerMemoryOverride: answerMemory, reportOutputDir: path.join(outputRoot, 'exports'), cvOutputDir: configuration.artifactRoot,
    requireCvReverification: true });
  await core.start();
};
const reply = async (applicationId, text) => {
  const question = (await repository.pool.query('SELECT * FROM application_questions WHERE application_id=$1 AND answered_at IS NULL ORDER BY created_at DESC LIMIT 1', [applicationId])).rows[0];
  assert.ok(question, 'A pending human question must exist');
  const response = await fetch('http://127.0.0.1:3007/telegram/update', { method: 'POST',
    headers: { 'x-jobhunter-token': process.env.CORE_SERVICE_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ message: { chat: { id: 70007 }, text, reply_to_message: { message_id: Number(question.telegram_message_id) } } }) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result.result;
};
try {
  await new Promise((resolve, reject) => {
    board.server.once('error', reject);
    board.listen().then(resolve, reject);
  });
  await browserService.listen();
  browserClient = new BrowserClient({ baseUrl: `http://127.0.0.1:${browserService.server.address().port}`, token: configuration.token });
  await startCore();
  if (!process.argv.includes('--skip-bootstrap')) await bootstrapN8n();
  const gitSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { windowsHide: true })).stdout.trim();
  const n8nVersion = JSON.parse(await readFile('.tools/n8n/node_modules/n8n/package.json', 'utf8')).version;
  const ollamaVersion = await fetch(`${process.env.OLLAMA_BASE_URL}/api/version`).then(response => response.json());
  const postgresVersion = (await admin.query('SHOW server_version')).rows[0].server_version;
  try { unitEvidence = JSON.parse(await readFile('tests/results/stage3-unit.json', 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const sourceHashes = {};
  for (const file of ['services/core/discovery.mjs', 'services/core/normalization.mjs', 'services/core/repository.mjs',
    'services/core/fit.mjs', 'services/core/llm.mjs', 'services/core/application.mjs', 'services/core/cv.mjs',
    'services/core/server.mjs', 'services/core/telegram.mjs', 'services/core/reporting.mjs', 'services/core/reconciliation.mjs',
    'services/browser-service/server.mjs', 'services/browser-service/policy.mjs', 'services/mock-job-board/server.mjs',
    'scripts/test-stage-7.mjs', 'prompts/fit_analysis_compact.md', 'tests/stage3.test.mjs',
    ...(await readdir('n8n/workflows')).filter(name => /^WF-\d\d-.*\.json$/.test(name)).sort().map(name => `n8n/workflows/${name}`)]) {
    sourceHashes[file] = digest(await readFile(file));
  }
  const discovery = await run(1, { profile: 'mock' });
  assert.equal(discovery.errors.length, 0);
  assert.equal(discovery.discovered, 21);
  assert.equal((await repository.listRaw()).length, 21);
  const normalization = await run(2);
  assert.equal(normalization.errors.length, 0);
  assert.equal(normalization.canonical_count, 10);
  const jobs = await repository.listCanonicalJobs();
  assert.equal(jobs.length, 10);
  assert.equal((await repository.pool.query('SELECT COUNT(*)::int count FROM job_sources')).rows[0].count, 21);
  // Every discovered job passes through the REAL local Ollama-backed normal stage.
  // Batches are operational timeout control, not a title/target filter.
  for (const job of jobs) {
    const result = await run(3, { job_ids: [job.job_id] });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].job_id, job.job_id);
    assert.equal(result.results[0].error, undefined,
      `Real Ollama analysis must succeed for ${job.title}; no fallback is permitted: ${JSON.stringify(result.results[0])}`);
  }
  const analyses = (await repository.pool.query(`SELECT DISTINCT ON(job_id) * FROM job_analysis ORDER BY job_id,created_at DESC`)).rows;
  analysisEvidence = analyses.map(row => ({ job_id: row.job_id, title: jobs.find(job => job.job_id === row.job_id)?.title,
    decision: row.decision, fit: Number(row.overall_fit), prompt_version: row.prompt_version, reasons: row.analysis_json.reasons }));
  assert.equal(analyses.length, 10);
  assert.ok(analyses.every(row => row.model === process.env.LLM_FAST_MODEL), 'All fit analyses must use the configured real model');
  assert.ok(analyses.every(row => row.prompt_version === PROMPT_VERSION), 'All analyses must use this run\'s semantic prompt version');
  const factIds = new Set(factIndex(profile).keys());
  for (const row of analyses) for (const id of [...row.analysis_json.matched_fact_ids, ...row.analysis_json.cv_focus_fact_ids,
    ...row.analysis_json.requirements.flatMap(requirement => requirement.candidate_evidence_fact_ids)]) {
    assert.ok(factIds.has(id), `Analysis must reference verified fixture facts: ${id}`);
  }
  const ranked = analyses.filter(row => row.decision === 'AUTO_APPLY').sort((left, right) =>
    Number(right.application_priority) - Number(left.application_priority) || Number(right.overall_fit) - Number(left.overall_fit)
      || left.job_id.localeCompare(right.job_id));
  assert.ok(ranked.length > 0, 'No natural AUTO_APPLY candidate from real matching; Stage 7 remains FAIL');
  const selected = ranked[0];
  selectedJob = jobs.find(job => job.job_id === selected.job_id);
  // Acceptance verifies the expected role AFTER normal ranking, never selects by its ID.
  assert.equal(selectedJob.title, 'Mechanical R&D Engineer', 'Normal discovery and matching must naturally rank the intended acceptance role first');
  const cv = await run(4, { job_id: selectedJob.job_id });
  assert.equal(cv.qa.pass, true);
  assert.equal(digest(await readFile(cv.pdf_path)), cv.sha256);
  const parser = new PDFParse({ data: await readFile(cv.pdf_path) });
  let parsed; try { parsed = await parser.getText(); } finally { await parser.destroy(); }
  assert.ok(parsed.text.includes(profile.onboarding.legal_name));
  assert.ok(!/UNKNOWN|TODO|PLACEHOLDER|Senior CATIA/.test(parsed.text));
  const document = JSON.parse(await readFile(path.join(path.dirname(cv.pdf_path), 'cv.json'), 'utf8'));
  const html = await readFile(cv.html_path, 'utf8');
  const expectedContacts = {
    email: profile.onboarding.email, phone: profile.onboarding.phone,
    portfolio: profile.onboarding.portfolio_url, github: profile.onboarding.github_url,
    location: `${profile.candidate.base_location.city}, ${profile.candidate.base_location.country}`,
  };
  for (const [key, value] of Object.entries(expectedContacts)) {
    assert.equal(document.contacts[key], value, `CV JSON must retain verified ${key}`);
    assert.ok(parsed.text.includes(value), `PDF must render verified ${key}`);
    assert.ok(html.includes(value), `HTML must render verified ${key}`);
  }
  assert.equal(document.target_job_id, selectedJob.job_id);
  assert.equal(document.headline, selectedJob.title);
  assert.ok(document.bullets.length > 0);
  const facts = [...profile.experience, ...profile.projects, ...profile.education];
  for (const bullet of document.bullets) for (const id of bullet.source_fact_ids) {
    assert.ok(facts.some(fact => fact.id === id && fact.statements?.includes(bullet.text)), 'CV source IDs and exact text must match verified fixture facts');
  }
  const preview = path.join(path.dirname(cv.pdf_path), 'qa-page');
  await execFileAsync('pdftoppm', ['-r', '110', '-png', '-singlefile', cv.pdf_path, preview], { windowsHide: true });
  let application = await run(5, { job_id: selectedJob.job_id });
  assert.equal(application.status, 'NEEDS_USER');
  assert.equal(application.pending_question.field_name, 'start_date');
  const applicationId = application.application_id;
  assert.ok(sent.some(message => message.text?.includes(applicationId) && message.text.includes('Earliest available start date')),
    'Unknown date must produce a correlated Telegram request');
  const pausedRow = (await repository.pool.query('SELECT * FROM applications WHERE application_id=$1', [applicationId])).rows[0];
  const sessionId = pausedRow.last_state.browser_session_id;
  const checkpoint = JSON.parse(await readFile(path.join(configuration.stateRoot, `${sessionId}.json`), 'utf8'));
  assert.equal(checkpoint.current_step, 4);
  assert.equal(checkpoint.uploaded_file_hashes[0].sha256, cv.sha256);
  await core.stop(); core = null; repository = new Repository(connection.href); await startCore();
  assert.equal((await repository.pool.query('SELECT status FROM applications WHERE application_id=$1', [applicationId])).rows[0].status, 'NEEDS_USER');
  application = await reply(applicationId, '2026-11-01');
  assert.equal(application.status, 'CAPTCHA_WAIT');
  assert.ok(sent.some(message => message.method === 'sendPhoto' && message.photo_is_png && message.photo_size > 0
    && message.caption.includes(applicationId) && message.caption.includes(application.pending_question.request_id)),
  'CAPTCHA must be relayed as an actual PNG with application and request correlation');
  const captcha = await fixtureHumanCaptcha({ baseUrl, draftId: application.pending_question.draft_id, testToken });
  application = await reply(applicationId, captcha.code);
  assert.equal(application.status, 'NEEDS_USER');
  assert.equal(application.pending_question.field_name, 'salary_format');
  application = await reply(applicationId, '10000 PLN');
  assert.equal(application.status, 'NEEDS_USER');
  assert.equal(application.pending_question.type, 'VALIDATION');
  application = await reply(applicationId, '10000-12000 PLN');
  assert.equal(application.status, 'SUBMITTED');
  assert.ok(application.confirmation_id?.startsWith('MOCK-'));
  assert.equal(application.confirmation_evidence, 'NETWORK_AND_PAGE');
  assert.equal(board.submissions.size, 1);
  assert.equal(submitRequests, 1, 'Exactly one POST /submit must reach the backend, including idempotent duplicate requests');
  const backend = [...board.submissions.values()][0];
  assert.equal(backend.job_id, new URL(selectedJob.canonical_url).pathname.split('/').at(-1));
  assert.equal(backend.confirmation_id, application.confirmation_id);
  assert.equal(backend.uploaded.cv.header, '%PDF-');
  assert.equal(digest(Buffer.from(backend.uploaded.cv.content_base64, 'base64')), cv.sha256);
  assert.equal(backend.payload.marketing, false);
  assert.equal(backend.payload.website_trap, '');
  assert.equal(`${backend.payload.first_name} ${backend.payload.last_name}`, profile.onboarding.legal_name);
  assert.equal(backend.payload.email, profile.onboarding.email);
  assert.equal(backend.payload.start_date, '2026-11-01');
  assert.equal(backend.payload.salary_format, '10000-12000 PLN');
  assert.equal(backend.payload.timezone_overlap, '09:00-17:00 Europe/Warsaw');
  assert.equal(backend.completed_steps?.length ?? board.drafts.get(backend.draft_id).completed_steps.length, 7);
  const duplicate = await run(5, { job_id: selectedJob.job_id });
  assert.equal(duplicate.status, 'SUBMITTED');
  assert.equal(board.submissions.size, 1);
  assert.equal(submitRequests, 1);
  const submissionMessages = sent.filter(message => message.text?.includes('Application submitted'));
  assert.equal(submissionMessages.length, 1, 'Successful submission notification must be sent exactly once despite duplicate workflow execution');
  for (const value of [applicationId, application.confirmation_id, selectedJob.title, selectedJob.company, selectedJob.canonical_url]) {
    assert.ok(submissionMessages[0].text.includes(value), 'Submission notification must identify the confirmed application');
  }
  const summary = await run(6);
  assert.deepEqual({ discovered: summary.discovered, unique: summary.unique, analyzed: summary.analyzed,
    submitted: summary.submitted, awaiting_user: summary.awaiting_user, failed: summary.failed, skipped: summary.skipped },
  { discovered: 21, unique: 10, analyzed: 10, submitted: 1, awaiting_user: 0, failed: 0, skipped: 0 });
  assert.equal(summary.cvs, 1);
  assert.equal(summary.suitable, analyses.filter(row => ['AUTO_APPLY','REVIEW','STRETCH'].includes(row.decision)).length);
  assert.equal(summary.bands.reduce((total, band) => total + band.count, 0), 10);
  assert.ok(sent.some(message => /JobHunter (?:daily )?summary/.test(message.text ?? '') && message.text.includes('Discovered: 21')
    && message.text.includes('Unique: 10') && message.text.includes('Analyzed: 10') && message.text.includes('Submitted: 1')));
  assert.equal((await repository.pool.query('SELECT COUNT(*)::int count FROM applications')).rows[0].count, 1);
  const persisted = (await repository.pool.query(`SELECT a.*,c.sha256 AS cv_sha256 FROM applications a JOIN cv_versions c USING(cv_id) WHERE application_id=$1`, [applicationId])).rows[0];
  assert.equal(persisted.status, 'SUBMITTED');
  assert.equal(persisted.candidate_profile_id, profile.profile_id);
  assert.equal(persisted.confirmation_id, application.confirmation_id);
  assert.equal(persisted.cv_sha256, cv.sha256);
  assert.ok(persisted.submitted_at);
  const audit = (await repository.pool.query('SELECT event_type FROM events WHERE entity_id=$1', [applicationId])).rows;
  assert.ok(audit.some(event => event.event_type === 'TELEGRAM_ANSWERED'));
  assert.ok(audit.some(event => event.event_type === 'ANSWER_CONSUMED'));
  assert.ok(!audit.some(event => event.event_type === 'HITL_NOTIFICATION_FAILED'));
  assert.equal(audit.filter(event => event.event_type === 'SUBMISSION_NOTIFICATION_SENT').length, 1);
  assert.ok(!audit.some(event => event.event_type === 'SUBMISSION_NOTIFICATION_FAILED'));
  assert.equal((await repository.pool.query('SELECT COUNT(*)::int count FROM application_questions WHERE answered_at IS NULL')).rows[0].count, 0);
  const consentRows = (await repository.pool.query('SELECT * FROM consents')).rows;
  assert.equal(consentRows.length, 1);
  assert.equal(consentRows[0].consent_type, 'RECRUITMENT_TECHNICAL');
  assert.equal(digest(consentRows[0].consent_text), consentRows[0].consent_text_hash);
  const ledgerPath = path.join(outputRoot, 'exports', 'APPLICATIONS_LOG.md');
  const ledger = await readFile(ledgerPath, 'utf8');
  assert.equal(ledger.split(application.confirmation_id).length - 1, 1);
  const repeatedSummary = await run(6);
  const stableSummary = value => {
    const result = structuredClone(value);
    // A fresh reconciliation inspection has a fresh timestamp; its business
    // counts and actions must remain unchanged on an idempotent report rerun.
    delete result.reconciliation?.checked_at;
    return result;
  };
  assert.deepEqual(stableSummary(repeatedSummary), stableSummary(summary));
  assert.equal(await readFile(ledgerPath, 'utf8'), ledger);
  report = { stage: 7, status: 'PASS', started_at: started, completed_at: new Date().toISOString(), schema,
    execution_engine: 'real_n8n_cli', semantic_gateway: 'real_local_Ollama', model: process.env.LLM_FAST_MODEL,
    semantic_prompt_version: PROMPT_VERSION, separate_matching_unit_evidence: unitEvidence ?? null,
    environment: 'Windows native Node/PostgreSQL/n8n CLI; container runtime not exercised by this acceptance run',
    versions: { node: process.version, n8n: n8nVersion, ollama: ollamaVersion.version, postgres: postgresVersion, git_sha: gitSha }, source_hashes: sourceHashes,
    config_profile_hash: digest(await readFile(profilePath)), discovery_routes: ['mock_json', 'rss'], summary,
    selected_job: { job_id: selectedJob.job_id, title: selectedJob.title, canonical_url: selectedJob.canonical_url,
      decision: selected.decision, fit: Number(selected.overall_fit), application_priority: Number(selected.application_priority) },
    analysis_decisions: analysisEvidence,
    cv: { pdf_path: cv.pdf_path, sha256: cv.sha256, qa: cv.qa, preview_path: `${preview}.png`,
      known_contacts_verified: true, contacts: document.contacts, source_fact_ids: document.bullets.flatMap(bullet => bullet.source_fact_ids) },
    visual_review_status: 'RENDERED_AWAITING_REVIEW', application_id: applicationId, confirmation_id: application.confirmation_id,
    backend_submissions: 1, backend_submit_requests: submitRequests, duplicate_gate: true, core_restart_resume: true, unknown_fact_human_reply: true,
    captcha_image_relay: true, captcha_solver: 'isolated_fixture_human_no_OCR', validation_correction: true,
    checkpoint_cv_hash_verified: true, consent_audit_verified: true, optional_marketing_unchecked: true,
    global_dry_run: true, allow_real_submit: false, allow_mock_submit: true,
    telegram_transport: 'injected_capture', telegram_messages: sent, submission_notification_once: true,
    real_telegram_delivery_verified: false,
    application_audit_events: audit.map(event => event.event_type), output_root: outputRoot, executions };
} catch (error) {
  report = { stage: 7, status: 'FAIL', started_at: started, completed_at: new Date().toISOString(), schema,
    semantic_gateway: 'real_local_Ollama', semantic_prompt_version: PROMPT_VERSION,
    separate_matching_unit_evidence: unitEvidence ?? null, failed_stage: currentStage, error: error.message,
    selected_job: selectedJob ?? null, analysis_decisions: analysisEvidence, executions, output_root: outputRoot,
    backend_submissions: board.submissions.size, backend_submit_requests: submitRequests,
    allow_real_submit: false, no_mock_semantic_fallback: true };
  process.exitCode = 1;
  process.stderr.write(`${error.stack}\n`);
} finally {
  report.duration_ms = Date.parse(report.completed_at) - Date.parse(report.started_at);
  await mkdir('tests/results', { recursive: true });
  await writeFile('tests/results/stage7.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(outputRoot, 'stage7.json'), JSON.stringify(report, null, 2) + '\n');
  if (core?.server.listening) await core.stop(); else await repository.close();
  if (browserService.server.listening) await browserService.close();
  if (board.server.listening) await board.close();
  await admin.end();
  const executionTable = '| Stage | Stored successful n8n CLI executions | Duration (seconds) |\n|---|---|---:|\n' + [1, 2, 3, 4, 5, 6]
    .map(stage => {
      const items = executions.filter(item => item.stage === stage);
      return `| ${stage} | ${items.map(item => item.execution_id).join(', ') || 'Not completed'} | ${(items.reduce((total, item) => total + item.duration_ms, 0) / 1000).toFixed(1)} |`;
    }).join('\n');
  const details = report.status === 'PASS' ? `\n\nDB metrics: ${report.summary.discovered} raw, ${report.summary.unique} unique, ${report.summary.analyzed} analyzed, ${report.summary.suitable} suitable, 1 CV, 1 submitted, 0 awaiting user/failed/skipped. AUTO_APPLY/REVIEW/STRETCH remain separate: ${report.summary.bands.map(row => `${row.decision}=${row.count}`).join(', ')}. Backend submit POST requests: ${report.backend_submit_requests}; confirmed submissions: 1.\n\nNormal ranking selected **${report.selected_job.title}**, ${report.selected_job.decision}, fit ${report.selected_job.fit}. Confirmation: \`${report.confirmation_id}\`. Tailored headline and source statements verified; PDF text QA: PASS. SHA256: \`${report.cv.sha256}\`. Rendered preview: \`${report.cv.preview_path}\`; visual review status: ${report.visual_review_status}.\n\nPersistence verifies candidate/application/CV/confirmation identity and answered questions. CAPTCHA PNG bytes and Telegram request correlation were verified. Dynamic timezone field, human salary validation correction, untouched honeypot, unchecked optional marketing, audited technical consent, exactly one backend submit POST, and unchanged ledger after repeated WF-06 were verified. Daily summary totals and captured notification match the PostgreSQL counts.\n\nEnvironment: ${report.environment}. Versions: Node ${report.versions.node}, PostgreSQL ${report.versions.postgres}, n8n ${report.versions.n8n}, Ollama ${report.versions.ollama}; model ${report.model}; tested Git base \`${report.versions.git_sha}\`. Source hashes record the working tree used by this run. Failed assertions: 0.` : `\n\nFailed assertion/error: ${report.error}. Backend submit POST requests: ${report.backend_submit_requests}; confirmed submissions: ${report.backend_submissions}.`;
  await writeFile('docs/STAGE_7_E2E_REPORT.md', `# Stage 7 — full mock pipeline\n\nOVERALL: ${report.status}\n\nStart: ${report.started_at}. End: ${report.completed_at}. Total: ${(report.duration_ms / 1000).toFixed(1)} seconds.\n\n${report.status === 'PASS' ? 'All six actual n8n workflows ran with PostgreSQL state, real local Ollama fit analysis of all ten discovered vacancies, a factual PDF and the eight-step browser application. Normal ranking selected the candidate; no target-ID filter or fake semantic gateway was used. Human fixture replies resolved an unknown date, image CAPTCHA and salary validation. Core restart preserved checkpoint state; mock submission was confirmed exactly once; the ledger was idempotent.' : `Failure: ${report.error}. No successful full-pipeline claim is made.`}\n\n${executionTable}${details}\n\nMachine evidence: \`tests/results/stage7.json\`. Isolated schema: \`${schema}\`. Artifacts: \`${outputRoot}\`.\n\nRun: \`node --env-file=.env scripts/test-stage-7.mjs --skip-bootstrap\` (PowerShell: \`.\\scripts\\test-stage-7.ps1 -SkipBootstrap\`; shell: \`./scripts/test-stage-7.sh --skip-bootstrap\`). Real submissions stay disabled. Telegram transport is captured locally; real bot delivery and the separate post-Stage-7 real-discovery readiness gate remain unverified by this test.\n`);
}
process.stdout.write(`${JSON.stringify({ stage: 7, status: report.status, error: report.error, schema })}\n`);
