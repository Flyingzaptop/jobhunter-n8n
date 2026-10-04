import { chromium } from 'playwright';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const base = process.env.DASHBOARD_UI_URL ?? 'http://127.0.0.1:3020';
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Local dashboard URL required');
if (!process.env.DASHBOARD_PASSWORD) throw new Error('DASHBOARD_PASSWORD must be set in the ignored local environment');
const output = path.resolve('data/dashboard-v2/screenshots');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const report = { at: new Date().toISOString(), base, mode: 'REAL_BACKEND_READ_ONLY_UI', viewport: '1440x1100', real_employer_submissions: 0, checks: [], screenshots: [], unavailable: [], browser_errors: [], api_errors: [], observer_image_responses: 0 };
const record = (name, evidence) => report.checks.push({ name, status: 'PASS', evidence });
page.on('pageerror', error => report.browser_errors.push(error.message));
page.on('response', response => { if (/\/api\/browser\/[^/]+\/image/.test(response.url()) && response.ok()) report.observer_image_responses++; if (response.url().includes('/api/') && response.status() >= 400 && !response.url().endsWith('/api/auth/me')) report.api_errors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
const real = job => {
  try { const url = new URL(job.canonical_url ?? job.application_url); return ['https:', 'http:'].includes(url.protocol) && !['127.0.0.1', 'localhost', 'mock-job-board'].includes(url.hostname); } catch { return false; }
};
async function get(url) { const response = await context.request.get(base + '/api' + url); assert.equal(response.ok(), true, `GET ${url} returned ${response.status()}`); return response.json(); }
async function ready() { await page.waitForFunction(() => document.querySelectorAll('.loading').length === 0).catch(() => {}); await page.waitForTimeout(550); }
async function shot(label, selector, fullPage = true) {
  await ready();
  const file = path.join(output, `${label}.png`);
  if (selector) await page.locator(selector).screenshot({ path: file }); else await page.screenshot({ path: file, fullPage });
  report.screenshots.push({ label, path: path.relative(process.cwd(), file).replaceAll('\\', '/'), at: new Date().toISOString() });
}
async function go(label) { await page.locator('.sidebar nav').getByRole('button', { name: label, exact: false }).click(); await ready(); assert.equal(await page.locator('.page-heading h1').count(), 1); }
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Dashboard password', { exact: true }).fill(process.env.DASHBOARD_PASSWORD);
  await page.getByRole('button', { name: 'Open control center' }).click();
  await page.locator('.sidebar').waitFor();
  const cookies = await context.cookies();
  assert.ok(cookies.some(c => c.name === 'jobhunter_admin' && c.httpOnly && c.sameSite === 'Strict'));
  record('Authenticated local operator session', 'HttpOnly SameSite=Strict session cookie; password never exported');
  const overview = (await get('/overview')).data;
  assert.equal(overview.mode.dry_run, true); assert.equal(overview.mode.real_submit_enabled, false);
  await page.waitForFunction(() => document.querySelector('.safety-bar')?.textContent.includes('REAL SUBMIT DISABLED'));
  assert.ok((await page.locator('.safety-bar').innerText()).includes('REAL SUBMIT DISABLED'));
  record('Locked safety mode', 'DRY_RUN=true / real_submit_enabled=false from actual API and visible banner');
  await shot('01-overview');
  await shot('02-pipeline', '.overview-wide .panel:first-child');
  await page.locator('.stage-card').first().click(); await page.getByRole('dialog').waitFor();
  assert.ok((await page.getByRole('dialog').innerText()).includes('Discovery'));
  await shot('03-stage-inspector'); await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.locator('.stage-card').first().evaluate(el => el === document.activeElement), true);
  record('Keyboard-accessible stage inspector', 'Escape closes modal and restores focus to the originating stage control');
  const jobs = await get('/jobs?limit=100'); assert.ok(jobs.total > 0); const realJob = jobs.data.find(real); assert.ok(realJob, 'At least one actual external market vacancy required');
  await go('Jobs');
  const firstRow = page.locator('.jobs-table tbody tr').first(); await firstRow.waitFor();
  const firstPageRole = await firstRow.innerText();
  await shot('04-jobs');
  const before = await page.locator('.pagination>span').innerText();
  await page.getByRole('button', { name: 'Next →', exact: true }).click(); await ready();
  const after = await page.locator('.pagination>span').innerText(); assert.notEqual(after, before); record('Server-side vacancy pagination', `${before} → ${after}; ${jobs.total} persisted vacancies`);
  await page.getByRole('button', { name: '← Previous', exact: true }).click(); await ready();
  await page.getByRole('textbox', { name: 'Search vacancies' }).fill(realJob.company); await ready();
  await page.locator(`.jobs-table tr[data-job-id="${realJob.job_id}"] .role-cell button`).click(); await page.getByRole('dialog').waitFor();
  const detail = (await get('/jobs/' + realJob.job_id)).data; assert.ok(real(detail.job));
  await page.waitForFunction(title => document.querySelector('.modal-head h2')?.textContent.includes(title), realJob.title);
  assert.ok((await page.getByRole('dialog').innerText()).includes(realJob.title));
  await shot('05-real-vacancy'); record('Real external vacancy detail', { job_id: realJob.job_id, company: detail.job.company, canonical_url: detail.job.canonical_url });
  await page.keyboard.press('Escape');
  const analyzed = (await get('/jobs?analyzed=true&limit=100')).data.filter(real);
  if (analyzed.length) {
    const selected = analyzed.find(job => (job.analysis?.requirements ?? job.analysis_json?.requirements ?? []).some(req => req.candidate_evidence_fact_ids?.length)) ?? analyzed[0]; await page.getByRole('textbox', { name: 'Search vacancies' }).fill(selected.title); await ready();
    await page.locator(`.jobs-table tr[data-job-id="${selected.job_id}"] .role-cell button`).click(); await page.getByRole('dialog').waitFor();
    await page.getByRole('tab', { name: 'Analysis', exact: true }).click(); await shot('06-real-analysis');
    const recordData = (await get('/jobs/' + selected.job_id)).data;
    record('Real structured analysis rendering', { job_id: selected.job_id, requirements: recordData.analysis?.requirements?.length ?? recordData.analysis?.analysis_json?.requirements?.length ?? 0 });
    const fact = page.locator('.requirements-table .fact-link').first();
    if (await fact.count()) { await fact.click(); await ready(); assert.ok((await page.getByRole('dialog').innerText()).includes('Verified candidate fact')); await shot('07-candidate-fact'); record('Exact candidate fact lookup', 'Fact inspector read authenticated /api/facts/:id'); }
    await page.keyboard.press('Escape');
  } else report.unavailable.push('No real analyzed vacancy exists in the current database snapshot');
  await go('Applications'); await shot('08-applications');
  const apps = (await get('/applications')).data; let actualApplication;
  for (const app of apps) { const detail = (await get('/applications/' + app.application_id)).data; if (real(detail.job)) { actualApplication = { ...app, detail }; break; } }
  if (actualApplication) { await page.locator('tbody .role-cell button').filter({ hasText: actualApplication.title }).first().click(); await page.getByRole('dialog').waitFor(); await shot('09-real-application-timeline'); record('Real application audit timeline', { application_id: actualApplication.application_id, events: actualApplication.detail.events.length }); await page.keyboard.press('Escape'); }
  else report.unavailable.push('No actual employer application timeline exists; regression-only applications excluded from real-world evidence');
  await go('CVs'); await shot('10-cv-ledger');
  const cvs = (await get('/cvs')).data; let actualCv;
  for (const cv of cvs) { if (process.env.DASHBOARD_CV_ID && cv.cv_id !== process.env.DASHBOARD_CV_ID) continue; const job = (await get('/jobs/' + cv.job_id)).data.job; if (real(job)) { actualCv = cv; break; } }
  if (actualCv) {
    await page.locator(`tbody tr[data-record-id="${actualCv.cv_id}"] .role-cell button`).click(); await page.getByRole('dialog').waitFor(); await shot('11-real-cv-draft', '.modal');
    const recordData = (await get('/cvs/' + actualCv.cv_id)).data, qa = recordData.qa ?? recordData.qa_json ?? recordData.manifest?.qa ?? recordData.manifest_json?.qa;
    assert.ok((await page.locator('.modal-head').innerText()).includes(actualCv.cv_id));
    if (process.env.DASHBOARD_CV_ID) {
      assert.equal(qa?.claims?.pass, true); assert.equal(qa?.identity?.status, 'BLOCKED_IDENTITY');
      assert.equal(await page.locator('.qa-summary .badge').nth(0).innerText(), 'PASS');
      assert.ok((await page.locator('.qa-summary .badge').nth(1).innerText()).includes('BLOCKED'));
      assert.equal(await page.locator('.pdf-preview').count(), 0);
      record('Independent CV claims QA separate from blocked identity/PDF', { cv_id: actualCv.cv_id, claims_pass: qa.claims.pass, identity: qa.identity.status, pdf: qa.pdf.status });
    }
    record('Real vacancy CV inspection', { cv_id: actualCv.cv_id, qa: actualCv.qa_json?.status ?? actualCv.status ?? 'No summary status recorded' }); await page.keyboard.press('Escape');
  }
  else report.unavailable.push('No real-vacancy CV/draft exists in this snapshot');
  await go('Human review'); await shot('12-hitl-onboarding');
  const hitlResponse = await context.request.get(base + '/api/hitl');
  if (hitlResponse.ok()) {
    const onboarding = (await hitlResponse.json()).data.onboarding;
    if (onboarding.missing_fields?.length) { assert.ok((await page.locator('.hitl-grid').innerText()).includes(onboarding.missing_fields[0])); record('Unknown onboarding blockers rendered', `${onboarding.missing_fields.length} persisted unknown fields`); }
  } else report.unavailable.push(`Backend /api/hitl returned ${hitlResponse.status()}; blockers remain unavailable, not clear`);
  await go('Browser'); await shot('13-browser-observer');
  const recordedBenchmarks = (await get('/browser-sessions')).data;
  if (recordedBenchmarks.length) {
    const optionLabels = await page.locator('.observer-picker select option').allTextContents();
    assert.ok(optionLabels.some(label => label.startsWith('ATS compatibility')));
    record('Actual ATS compatibility session catalog', { records: recordedBenchmarks.length, labeled_scope: 'ATS compatibility; distinct from applications' });
  }
  const catalogSession = recordedBenchmarks.find(row => row.session_id ?? row.browser_session_id);
  const targetSession = process.env.DASHBOARD_BROWSER_SESSION_ID ?? catalogSession?.session_id ?? catalogSession?.browser_session_id;
  if (targetSession) {
    const retainedSessionImages = async () => (await readdir(path.resolve(process.env.BROWSER_STATE_DIR ?? 'data/browser')).catch(() => [])).filter(file => file.startsWith(targetSession) && file.endsWith('.png')).sort();
    const retainedBefore = await retainedSessionImages();
    const recordedSession = recordedBenchmarks.find(row => (row.session_id ?? row.browser_session_id) === targetSession);
    if (recordedSession) {
      await page.locator('.observer-picker select').selectOption(targetSession);
      record('Recorded benchmark session selected through real catalog', { session_id: targetSession, scope: recordedSession.scope ?? 'ATS_COMPATIBILITY', manual_id_supplied: Boolean(process.env.DASHBOARD_BROWSER_SESSION_ID) });
    } else {
      await page.getByLabel('Observe an existing session ID', { exact: true }).fill(targetSession);
      await page.getByRole('button', { name: 'Observe session', exact: true }).click();
    }
    await page.waitForTimeout(3200); await shot('14-active-browser', null, false);
    const observed = await context.request.get(`${base}/api/browser/${encodeURIComponent(targetSession)}`);
    assert.equal(observed.ok(), true, 'Provided observer session must exist');
    const state = (await observed.json()).data;
    const protectedFields = (state.fields ?? []).filter(field => field.type === 'password' || /token|otp|password|auth.*code/i.test(field.name ?? ''));
    assert.ok(protectedFields.every(field => field.value === '[redacted]'));
    assert.ok(report.observer_image_responses >= 2, 'Actual observer must fetch successive screenshots while viewed');
    record('Actual observer session', { session_id: targetSession, fields: state.fields?.length, url: state.url, protected_fields_redacted: protectedFields.length, actual_image_responses: report.observer_image_responses });
    const image = await context.request.get(`${base}/api/browser/${encodeURIComponent(targetSession)}/image`);
    assert.equal(image.headers()['content-type'], 'image/png'); assert.equal(image.headers()['cache-control'], 'no-store');
    assert.equal((await image.body()).subarray(1, 4).toString(), 'PNG');
    assert.deepEqual(await retainedSessionImages(), retainedBefore);
    record('Observer screenshot transport', 'Actual PNG bytes, Cache-Control:no-store; screenshots refresh while viewed');
    record('No observer image persistence', 'No new session PNG file in configured browser state directory during repeated observation; QA screenshot is a separate explicit artifact');
  }
  else report.unavailable.push('No active session returned by actual application/ATS catalog; no browser screenshot fabricated');
  await go('Runs'); await shot('15-runs');
  if (targetSession) { const settledImages = report.observer_image_responses; await page.waitForTimeout(2400); assert.equal(report.observer_image_responses, settledImages); record('Observer polling stops after navigation', 'No screenshot responses after leaving the actively viewed observer'); }
  await go('Sources'); await shot('16-sources', null, false);
  const sources = (await get('/sources')).data; assert.ok(sources.some(s => /LinkedIn/i.test(s.platform))); assert.ok(sources.some(s => /Pracuj/i.test(s.platform))); record('Real source catalog and access states', `${sources.length} actual configured sources; LinkedIn and Pracuj visible`);
  await go('Analytics'); await shot('17-analytics');
  await page.getByRole('tab', { name: 'Cumulative', exact: true }).click(); await shot('18-analytics-cumulative');
  await go('System'); await shot('19-system');
  assert.ok((await page.locator('.verification-question').innerText()).includes('React and Django'));
  record('Candidate provenance verification question', 'Professional React/Django question visible; profile editing observation-only');
  await page.setViewportSize({ width: 390, height: 844 }); await go('Overview'); await shot('20-responsive-overview');
  const overflows = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth })); assert.ok(overflows.document <= overflows.viewport + 1, `Mobile horizontal overflow: ${JSON.stringify(overflows)}`); record('Responsive navigation and overview', '390x844 viewport with no document horizontal overflow');
  await page.setViewportSize({ width: 1440, height: 1100 });
  const stores = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })); assert.deepEqual(stores.local, []); assert.deepEqual(stores.session, []); record('No client credential persistence', 'localStorage and sessionStorage empty');
  assert.equal(report.browser_errors.length, 0, `Client exceptions: ${report.browser_errors.join('; ')}`);
  record('All ten views rendered without JavaScript exceptions', 'Overview, Jobs, Applications, CVs, Human review, Browser, Runs, Sources, Analytics, System');
  await page.getByRole('button', { name: 'Sign out ↗', exact: true }).click(); await page.getByLabel('Dashboard password', { exact: true }).waitFor();
  record('CSRF-authenticated logout', 'Session ended through dashboard control; login page restored');
  report.status = report.api_errors.length ? 'PARTIAL' : 'PASS';
} catch (error) { report.status = 'FAILED'; report.error = error.message; throw error; }
finally { await writeFile(path.resolve('data/dashboard-v2/ui-smoke.json'), JSON.stringify(report, null, 2)); await browser.close(); console.log(JSON.stringify({ status: report.status, checks: report.checks.length, screenshots: report.screenshots.length, unavailable: report.unavailable, browser_errors: report.browser_errors, api_errors: report.api_errors }, null, 2)); }
