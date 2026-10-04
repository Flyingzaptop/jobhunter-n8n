import test from 'node:test';
import assert from 'node:assert/strict';
import { text, safeUrl, duration, tone, onboardingRows } from '../src/display.mjs';
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
