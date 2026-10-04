import test from 'node:test';
import assert from 'node:assert/strict';
import { api, setCsrf, ApiError } from '../src/api.ts';
test('same-origin GET uses cookie credentials without client secrets', async () => {
  const original = globalThis.fetch; let called;
  globalThis.fetch = async (path, options) => { called = { path, options }; return new Response(JSON.stringify({ data: { jobs: 4 } }), { status: 200 }); };
  try { const result = await api('/overview'); assert.equal(result.data.jobs, 4); assert.equal(called.path, '/api/overview'); assert.equal(called.options.credentials, 'same-origin'); assert.equal(called.options.headers.Authorization, undefined); } finally { globalThis.fetch = original; }
});
test('mutations use the in-memory server-issued CSRF token', async () => {
  const original = globalThis.fetch; let called;
  globalThis.fetch = async (path, options) => { called = options; return new Response(JSON.stringify({ data: { status: 'QUEUED' } }), { status: 200 }); };
  try { setCsrf('server-issued-test'); await api('/control/trigger', { method: 'POST', body: { stage: 3 } }); assert.equal(called.headers['X-CSRF-Token'], 'server-issued-test'); assert.equal(called.body, '{"stage":3}'); setCsrf(null); } finally { globalThis.fetch = original; }
});
test('unauthorized responses end the session and are not fabricated as data', async () => {
  const original = globalThis.fetch, previousWindow = globalThis.window; let event;
  globalThis.window = { dispatchEvent(value) { event = value.type; } };
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 });
  try { await assert.rejects(api('/jobs'), error => error instanceof ApiError && error.status === 401); assert.equal(event, 'jobhunter:unauthorized'); } finally { globalThis.fetch = original; globalThis.window = previousWindow; }
});
test('control rejection retains server error and never reports queued success', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Application filling is disabled' }), { status: 409 });
  try { await assert.rejects(api('/control/trigger', { method: 'POST', body: { stage: 5 } }), /Application filling is disabled/); } finally { globalThis.fetch = original; }
});
