import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createDashboard } from '../services/dashboard/server.mjs';
import { createAuth } from '../services/dashboard/auth.mjs';
import { sanitize } from '../services/core/observability.mjs';

// Isolated auth-session persistence only. No vacancy/application data is created,
// and no model, browser, Telegram, or workflow call can execute in this harness.
function sessionRepository() {
  const sessions = new Map(), calls = [];
  return {
    sessions, calls, async migrate() {}, async close() {},
    async event() { throw new Error('Unexpected state mutation'); },
    pool: { async query(sql, values = []) {
      calls.push(sql);
      if (sql.startsWith('INSERT INTO admin_sessions')) { sessions.set(values[0], { session_hash: values[0], csrf_hash: values[1], expires_at: values[2] }); return { rows: [], rowCount: 1 }; }
      if (sql.startsWith('SELECT session_hash,csrf_hash,expires_at FROM admin_sessions')) { const row = sessions.get(values[0]); return { rows: row && row.expires_at > new Date() ? [row] : [] }; }
      if (sql.startsWith('UPDATE admin_sessions SET csrf_hash')) { const row = sessions.get(values[0]); if (row) row.csrf_hash = values[1]; return { rows: [], rowCount: row ? 1 : 0 }; }
      if (sql.startsWith('DELETE FROM admin_sessions')) return { rows: [], rowCount: Number(sessions.delete(values[0])) };
      throw new Error('Unexpected SQL outside isolated admin-session storage');
    } },
  };
}
const hash = value => createHash('sha256').update(value).digest('hex');

test('dashboard real HTTP boundary rejects unauthorized and unsafe operations', async t => {
  const repository = sessionRepository(), password = 'isolated-' + randomUUID();
  let dispatches = 0, browserCalls = 0;
  const app = createDashboard({ repository, password, port: 0,
    dispatch: async () => { dispatches++; }, browser: { async call() { browserCalls++; throw new Error('Browser execution forbidden in auth regression'); } },
  });
  await app.start();
  t.after(async () => { await app.stop(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = (route, { cookie, csrf, method = 'GET', body, headers = {} } = {}) => fetch(base + route, {
    method, headers: { ...(cookie ? { cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(body != null ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body != null ? { body: JSON.stringify(body) } : {}),
  });
  let cookie, csrf, sessionHash;
  await t.test('unauthenticated API and event stream return401 without persisted reads', async () => {
    for (const route of ['/api/overview', '/api/jobs', '/api/facts', '/api/events/stream', '/api/control/pause']) {
      const response = await request(route); assert.equal(response.status, 401);
      const body = await response.json(); assert.equal(body.error, 'Authentication required');
    }
    assert.equal(repository.calls.length, 0);
  });
  await t.test('incorrect login returns401 and creates no session', async () => {
    const response = await request('/api/auth/login', { method: 'POST', body: { password: 'incorrect-test-password' } });
    assert.equal(response.status, 401); assert.equal(repository.sessions.size, 0); assert.equal(response.headers.get('set-cookie'), null);
  });
  await t.test('valid login sets HttpOnly Strict cookie and stores hashes only', async () => {
    const response = await request('/api/auth/login', { method: 'POST', body: { password } });
    assert.equal(response.status, 200); const cookieHeader = response.headers.get('set-cookie');
    assert.match(cookieHeader, /HttpOnly/); assert.match(cookieHeader, /SameSite=Strict/); assert.match(cookieHeader, /Path=\//);
    cookie = cookieHeader.split(';')[0]; const rawSession = cookie.split('=')[1];
    csrf = (await response.json()).data.csrf_token; sessionHash = hash(rawSession);
    assert.equal(rawSession.length, 64); assert.equal(csrf.length, 64); assert.ok(repository.sessions.has(sessionHash));
    assert.notEqual(repository.sessions.get(sessionHash).session_hash, rawSession);
    assert.equal(repository.sessions.get(sessionHash).csrf_hash, hash(csrf));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
  await t.test('mutation requests without valid CSRF return403 before any operation', async () => {
    for (const token of [undefined, 'wrong-csrf-test']) {
      const response = await request('/api/control/trigger', { cookie, csrf: token, method: 'POST', body: { stage: 1 } });
      assert.equal(response.status, 403); assert.equal((await response.json()).error, 'CSRF validation failed');
    }
    assert.equal(dispatches, 0);
  });
  await t.test('GET cannot invoke control actions or logout', async () => {
    for (const route of ['/api/control/pause', '/api/control/resume', '/api/control/trigger', '/api/auth/logout']) {
      const response = await request(route, { cookie }); assert.equal(response.status, 405);
    }
    assert.equal(repository.sessions.size, 1); assert.equal(dispatches, 0);
  });
  await t.test('valid CSRF cannot authorize arbitrary stages, commands, or submit enablement', async () => {
    for (const body of [{ stage: 0 }, { stage: 7 }, { stage: 1.5 }, { stage: 'curl attacker.example' }, { stage: 1, command: 'arbitrary command' }, { stage: 5, allow_real_submit: true }]) {
      const response = await request('/api/control/trigger', { cookie, csrf, method: 'POST', body }); assert.equal(response.status, 400);
    }
    for (const route of ['/api/control/enable-submit', '/api/control/execute', '/api/control/configure']) {
      const response = await request(route, { cookie, csrf, method: 'POST', body: {} }); assert.equal(response.status, 404);
    }
    assert.equal(dispatches, 0); assert.equal(browserCalls, 0);
    assert.ok(repository.calls.every(sql => /admin_sessions/.test(sql)));
  });
  await t.test('invalid artifact/run/browser IDs are rejected before file or browser access', async () => {
    for (const route of ['/api/cvs/not-a-uuid/pdf', '/api/runs/not-a-uuid', '/api/browser/not-a-uuid/image']) {
      const response = await request(route, { cookie }); assert.equal(response.status, 400);
    }
    assert.equal(browserCalls, 0);
  });
  await t.test('cross-origin requests are rejected even with valid session and CSRF', async () => {
    const response = await request('/api/control/trigger', { cookie, csrf, method: 'POST', body: { stage: 0 }, headers: { Origin: 'https://attacker.example' } });
    assert.equal(response.status, 403); assert.equal((await response.json()).error, 'Origin not allowed');
    assert.equal(dispatches, 0);
  });
  await t.test('response policy restricts scripts, frames, connections, and embedding', async () => {
    const response = await request('/api/not-found', { cookie });
    const policy = response.headers.get('content-security-policy');
    for (const rule of ["script-src 'self'", "connect-src 'self'", "frame-src 'self'", "object-src 'none'", "frame-ancestors 'none'"]) assert.ok(policy.includes(rule));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  });
  await t.test('session refresh rotates CSRF and invalidates the old token', async () => {
    const oldCsrf = csrf;
    const response = await request('/api/auth/me', { cookie }); assert.equal(response.status, 200);
    const data = (await response.json()).data; assert.equal(data.authenticated, true); csrf = data.csrf_token; assert.notEqual(csrf, oldCsrf);
    assert.equal((await request('/api/control/trigger', { cookie, csrf: oldCsrf, method: 'POST', body: { stage: 0 } })).status, 403);
    assert.equal((await request('/api/control/trigger', { cookie, csrf, method: 'POST', body: { stage: 0 } })).status, 400);
  });
  await t.test('logout requires CSRF and revokes cookie replay', async () => {
    assert.equal((await request('/api/auth/logout', { cookie, method: 'POST', csrf: 'invalid-test-csrf' })).status, 403);
    const response = await request('/api/auth/logout', { cookie, csrf, method: 'POST' }); assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal(repository.sessions.size, 0); assert.equal((await request('/api/auth/me', { cookie })).status, 401);
  });
});

test('dashboard login backoff and expired session handling are isolated from real operator state', async () => {
  const repository = sessionRepository(), auth = createAuth(repository, { password: 'isolated-long-password', ttlMs: 50 }), req = { socket: { remoteAddress: 'isolated-test-address' }, headers: {} };
  for (let i = 0; i < 5; i++) await assert.rejects(auth.login(req, 'incorrect'), error => error.status === 401);
  await assert.rejects(auth.login(req, 'isolated-long-password'), error => error.status === 429);
  const other = { socket: { remoteAddress: 'isolated-other-address' }, headers: {} };
  const login = await auth.login(other, 'isolated-long-password');
  repository.sessions.get(hash(login.session)).expires_at = new Date(Date.now() - 1);
  assert.equal(await auth.session({ headers: { cookie: `jobhunter_admin=${login.session}` } }), null);
});

test('observable records omit credentials and hidden reasoning while retaining real runtime metadata', () => {
  const value = sanitize({
    password: 'private-test-value', cookie: 'private-test-value', authorization: 'private-test-value',
    credential: 'private-test-value', secret: 'private-test-value', storage_state: 'private-test-value',
    raw_prompt: 'private-test-value', chain_of_thought: 'private-test-value', hidden_reasoning: 'private-test-value',
    metadata: { bot_token: 'private-test-value', model: 'actual-recorded-model', prompt_eval_count: 42 },
    at: new Date('2026-10-04T06:59:00Z'), url: 'https://api.telegram.org/botprivate-test-value/sendMessage',
  });
  assert.equal(JSON.stringify(value).includes('private-test-value'), false);
  assert.equal(value.metadata.model, 'actual-recorded-model'); assert.equal(value.metadata.prompt_eval_count, 42);
  assert.equal(value.at, '2026-10-04T06:59:00.000Z'); assert.equal(value.url, 'https://api.telegram.org/bot[redacted]/sendMessage');
});
