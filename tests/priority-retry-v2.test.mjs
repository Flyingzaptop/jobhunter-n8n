import test from 'node:test';
import assert from 'node:assert/strict';
import { computePriority } from '../services/core/priority.mjs';
import { classifyAnalysisFailure, retryPlan } from '../services/core/analysis-retry.mjs';

const now = new Date('2026-10-04T00:00:00Z');
const job = { canonical_url: 'https://example.invalid/jobs/42', availability_status: 'OPEN',
  published_at: '2026-10-03T00:00:00Z', last_verified_open_at: '2026-10-04T00:00:00Z', ats_identity: 'greenhouse:employer:42' };
const analysis = { overall_fit: 80, role_family: 'mechanical_engineering', career_alignment: 'HIGH',
  work_format_class: 'REMOTE_EU_FROM_POLAND', eligible_for_auto_apply: true, employment_eligibility: { hire_route: 'PL_EMPLOYEE' } };
const part = (result, key) => result.priority_components.find(component => component.key === key);

test('priority exposes independently weighted reasons while keeping qualification fit and routing intact', () => {
  const before = structuredClone(analysis);
  const remote = computePriority({ job, analysis, now });
  const relocation = computePriority({ job, analysis: { ...analysis, work_format_class: 'RELOCATION_REVIEW' }, now });
  assert.deepEqual(analysis, before);
  assert.equal(part(remote, 'qualification_fit').value, 80);
  assert.equal(part(relocation, 'qualification_fit').value, 80);
  assert.equal(remote.application_priority - relocation.application_priority, 9.75);
  assert.equal(remote.application_priority, remote.priority_components.reduce((total, component) => total + component.contribution, 0));
  assert.equal(remote.priority_components.reduce((total, component) => total + component.weight, 0), 1);
  assert.equal(remote.salary_contribution, 0);
});
test('unknown eligibility, old vacancy and closed status cannot gain confirmed feasibility/freshness credit', () => {
  const unknown = computePriority({ job: { canonical_url: 'https://example.invalid/jobs/42', availability_status: 'UNKNOWN' },
    analysis: { ...analysis, overall_fit: null, eligible_for_auto_apply: false, employment_eligibility: { hire_route: 'UNKNOWN' } }, now });
  assert.equal(part(unknown, 'qualification_fit').value, 0);
  assert.equal(part(unknown, 'employment_feasibility').value, 25);
  assert.equal(part(unknown, 'freshness').value, 40);
  assert.equal(part(unknown, 'vacancy_status_confidence').value, 25);
  const oldClosed = computePriority({ job: { ...job, published_at: '2026-08-01T00:00:00Z', availability_status: 'CLOSED' },
    analysis: { ...analysis, eligible_for_auto_apply: false, employment_eligibility: { blocker: true } }, now });
  assert.equal(part(oldClosed, 'freshness').value, 20);
  assert.equal(part(oldClosed, 'employment_feasibility').value, 0);
  assert.equal(part(oldClosed, 'vacancy_status_confidence').value, 0);
});
test('retry policy distinguishes network fetch TypeError from programming/configuration TypeError', () => {
  assert.equal(classifyAnalysisFailure(Object.assign(new Error('Cloud request failed'),{code:'HTTP_429'})), 'TRANSIENT');
  assert.equal(classifyAnalysisFailure(Object.assign(new Error('Cloud request failed'),{code:'HTTP_503'})), 'TRANSIENT');
  assert.equal(classifyAnalysisFailure(Object.assign(new Error('Cloud request failed'),{code:'HTTP_401'})), 'SEMANTIC_OR_CONFIGURATION');
  assert.equal(classifyAnalysisFailure(new TypeError('Cannot read properties of undefined')), 'SEMANTIC_OR_CONFIGURATION');
  assert.equal(classifyAnalysisFailure(new TypeError('fetch failed')), 'TRANSIENT');
  assert.equal(classifyAnalysisFailure(Object.assign(new Error('aborted'), { name: 'AbortError' })), 'TRANSIENT');
  assert.equal(classifyAnalysisFailure(new Error('Ollama HTTP 503')), 'TRANSIENT');
  assert.equal(classifyAnalysisFailure(new Error('Ollama HTTP 401')), 'SEMANTIC_OR_CONFIGURATION');
  assert.equal(classifyAnalysisFailure(Object.assign(new Error('Unknown candidate evidence ID'), { name: 'StructuredOutputError' })), 'SEMANTIC_OR_CONFIGURATION');
});
test('transient retries back off within budget and semantic failures immediately dead-letter', () => {
  const transient = new Error('Ollama HTTP 429');
  const first = retryPlan(transient, 1, { now }); const second = retryPlan(transient, 2, { now }); const final = retryPlan(transient, 3, { now });
  assert.equal(first.next_retry_at, '2026-10-04T00:01:00.000Z');
  assert.equal(second.next_retry_at, '2026-10-04T00:02:00.000Z');
  assert.equal(final.status, 'ANALYSIS_DEAD_LETTER'); assert.equal(final.next_retry_at, null);
  const semantic = retryPlan(new TypeError('Invalid policy shape'), 1, { now });
  assert.equal(semantic.retryable, false); assert.equal(semantic.status, 'ANALYSIS_DEAD_LETTER');
});
