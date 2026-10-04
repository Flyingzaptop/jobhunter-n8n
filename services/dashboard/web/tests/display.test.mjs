import test from 'node:test';
import assert from 'node:assert/strict';
import { text, safeUrl, duration, tone, onboardingRows, actionLabel, sessionOptions } from '../src/display.mjs';
test('unknown, zero and false remain distinct', () => {
  assert.equal(text(null), 'Not recorded'); assert.equal(text(0), '0'); assert.equal(text(false), 'No');
});
test('untrusted vacancy links cannot execute script or open local files', () => {
  for (const url of ['javascript:alert(1)', 'file:///secret', 'data:text/html,<script>', '/api/control']) assert.equal(safeUrl(url), null);
  assert.equal(safeUrl('https://example.com/jobs/1'), 'https://example.com/jobs/1');
});
test('missing start times are not presented as zero-duration runs', () => {
  assert.equal(duration(null), 'Not recorded'); assert.equal(duration('2026-01-01T00:00:00Z', '2026-01-01T00:02:04Z'), '2m 4s');
  assert.equal(duration('2026-01-01T00:00:00Z', 'malformed timestamp'), 'Not recorded');
});
test('unknown and blocked states are never green', () => {
  assert.equal(tone('UNKNOWN'), 'amber'); assert.equal(tone('DRY_RUN_BLOCKED'), 'amber'); assert.equal(tone('FAILED'), 'red');
});
test('onboarding supports actual missing-fields API without losing blockers', () => {
  const records = onboardingRows({ missing_fields: ['onboarding.email', 'onboarding.legal_name'] });
  assert.deepEqual(records.map(r => r.field), ['onboarding.email', 'onboarding.legal_name']);
  assert.ok(records.every(r => r.status === 'UNKNOWN'));
  assert.deepEqual(onboardingRows(null), []);
});
test('browser action presents recorded operation without dumping trace metadata', () => {
  assert.equal(actionLabel({ operation: 'observe-image', selector: null, started_at: 'recorded' }), 'Refreshing the live browser view');
  assert.equal(actionLabel({ message: 'Waiting for an actual user question', operation: 'fill' }), 'Waiting for an actual user question');
  assert.equal(actionLabel(null), 'No current action recorded');
});
test('genuine benchmark sessions remain distinct from application sessions', () => {
  const id = '11111111-2222-4333-8444-555555555555';
  const options = sessionOptions([{ application_id: 'without-session' }], [{ browser_session_id: id, company: 'Recorded company', title: 'Recorded role', adapter: 'greenhouse', status: 'CAPTCHA_WAIT' }]);
  assert.equal(options.length, 1); assert.equal(options[0][0], id);
  assert.match(options[0][1], /^ATS compatibility/); assert.match(options[0][1], /CAPTCHA_WAIT/);
  assert.equal(sessionOptions([], [{ session_id: 'not-a-session' }]).length, 0);
});
test('duplicate session IDs prefer explicit benchmark scope without fabricating applications', () => {
  const id = '11111111-2222-4333-8444-555555555555';
  const options = sessionOptions([{ last_state: { browser_session_id: id } }], [{ session_id: id, scope: 'ATS_COMPATIBILITY' }]);
  assert.equal(options.length, 1); assert.match(options[0][1], /^ATS compatibility/);
  assert.match(options[0][1], /Company unknown/);
});
