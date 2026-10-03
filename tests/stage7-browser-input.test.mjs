import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { browserConfig, createBrowserService } from '../services/browser-service/server.mjs';

test('Stage 7 browser API rejects malformed application and session IDs before creating state or reading outside checkpoints', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jobhunter-stage7-boundary-'));
  const stateRoot = path.join(directory, 'state');
  await mkdir(stateRoot);
  const outsidePath = path.join(directory, 'outside.json');
  const sentinel = JSON.stringify({ submission_confirmation: { confirmation_id: 'OUTSIDE-CHECKPOINT-MUST-NOT-LEAK' } });
  await writeFile(outsidePath, sentinel);
  const token = 'isolated-stage7-browser-boundary';
  const service = await createBrowserService({ ...browserConfig({ BROWSER_SERVICE_TOKEN: token,
    BROWSER_STATE_DIR: stateRoot, ARTIFACT_DIR: path.join(directory, 'cv') }), port: 0 });
  await service.listen();
  try {
    const base = `http://127.0.0.1:${service.server.address().port}`;
    const request = async (endpoint, body, method = body ? 'POST' : 'GET') => {
      const response = await fetch(base + endpoint, { method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, result: await response.json() };
    };
    for (const application_id of ['../outside', '..\\outside', '/absolute', 'C:\\outside', '', 'fixture\n', '%2e%2e%2foutside', 'a'.repeat(101), 42, {}, ['fixture']]) {
      const response = await request('/sessions', { application_id });
      assert.equal(response.status, 400, `Invalid application ID must fail: ${JSON.stringify(application_id)}`);
      assert.equal(response.result.error, 'INVALID_APPLICATION_ID');
      assert.equal(service.sessions.size, 0, 'Rejected identifiers must not create a browser context/session');
    }
    for (const id of ['%2e%2e%2foutside', '..%5coutside', 'outside.json', 'a'.repeat(36), '-'.repeat(36), 'not-a-session']) {
      for (const [operation, method] of [['recover', 'POST'], ['snapshot', 'GET'], ['checkpoint', 'POST']]) {
        const response = await request(`/sessions/${id}/${operation}`, method === 'POST' ? {} : undefined, method);
        assert.ok(response.status >= 400, `Invalid session ID must fail: ${id}/${operation}`);
        if (response.status === 400) assert.equal(response.result.error, 'INVALID_SESSION_ID');
        else assert.equal(response.status, 404);
        assert.ok(!JSON.stringify(response.result).includes('OUTSIDE-CHECKPOINT-MUST-NOT-LEAK'));
      }
    }
    assert.deepEqual(await readdir(stateRoot), [], 'Invalid IDs must not create checkpoint or screenshot files');
    assert.equal(await readFile(outsidePath, 'utf8'), sentinel, 'Outside checkpoint must remain untouched');
  } finally {
    await service.close();
    const expectedPrefix = path.resolve(os.tmpdir()) + path.sep + 'jobhunter-stage7-boundary-';
    assert.ok(path.resolve(directory).startsWith(expectedPrefix));
    await rm(directory, { recursive: true, force: true });
  }
});
