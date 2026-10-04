import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Repository } from '../services/core/repository.mjs';
import { Telegram, getTelegramPollingCursor } from '../services/core/telegram.mjs';
import { pollTelegramOnce } from '../scripts/telegram-poll.mjs';
import { createCore } from '../services/core/server.mjs';

test('durable Telegram inbox, cursor and dispatch survive duplicate/failure/restart with actual PostgreSQL',
  { skip: !process.env.DATABASE_URL, timeout: 60000 }, async t => {
  const repo = new Repository(); const admin = repo.pool;
  const schema = `telegram_test_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^telegram_test_[a-f0-9]{32}$/);
  await admin.query(`CREATE SCHEMA ${schema}`);
  repo.pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public`, max: 8 });
  t.after(async () => { await repo.pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  await repo.migrate();
  let messageId = 1000;
  const telegram = new Telegram({ token: 'fixture-token', chatId: '123', fetchImpl: async () =>
    ({ ok: true, json: async () => ({ ok: true, result: { message_id: ++messageId } }) }) });
  const seed = async () => {
    const job = randomUUID(); const application = randomUUID();
    await repo.pool.query("INSERT INTO jobs(job_id,canonical_url,company,title,description_text) VALUES($1,$2,'Regression Employer','Regression role','Regression-only correlation fixture')", [job, `https://example.invalid/${job}`]);
    await repo.pool.query("INSERT INTO applications(application_id,candidate_profile_id,job_id,status) VALUES($1,'fixture',$2,'NEEDS_USER')", [application, job]);
    await telegram.request(repo, application, 'Fixture correlated question');
    const question = (await repo.pool.query('SELECT * FROM application_questions WHERE application_id=$1', [application])).rows[0];
    return { application, question };
  };
  const update = (id, text, replyId, chatId = 123) => ({ update_id: id, message: { message_id: id + 100,
    chat: { id: chatId }, text, ...(replyId ? { reply_to_message: { message_id: Number(replyId) } } : {}) } });
  const row = async id => (await repo.pool.query('SELECT * FROM telegram_processed_updates WHERE update_id=$1', [id])).rows[0];

  await t.test('concurrent replay applies the correlated answer, audit event and dispatch once', async () => {
    const seeded = await seed(); let dispatched = 0;
    const input = update(100, 'fixture-private-answer', seeded.question.telegram_message_id);
    const results = await Promise.all(Array.from({ length: 4 }, () => telegram.processUpdate(repo, input, async accepted => {
      assert.equal(accepted.application_id, seeded.application); assert.equal(accepted.question_id, seeded.question.question_id);
      assert.equal(accepted.raw_question, undefined); dispatched++; return { resumed: true };
    })));
    assert.equal(dispatched, 1); assert.equal(results.filter(result => !result.duplicate).length, 1);
    assert.equal((await repo.pool.query('SELECT answer FROM application_questions WHERE question_id=$1', [seeded.question.question_id])).rows[0].answer, 'fixture-private-answer');
    assert.equal((await repo.pool.query("SELECT count(*)::int n FROM events WHERE event_type='TELEGRAM_ANSWERED'")).rows[0].n, 1);
    assert.equal(await getTelegramPollingCursor(repo), 101);
    assert.equal((await row(100)).dispatch_status, 'COMPLETED');
    assert.ok(!JSON.stringify((await row(100)).correlation_json).includes('fixture-private-answer'));
  });
  await t.test('outcome update redelivery does not append duplicate outcome rows', async () => {
    const seeded = await seed(); const input = update(200, `/outcome ${seeded.application} OFFER`);
    await telegram.processUpdate(repo, input, () => { throw new Error('Outcome should not dispatch external work'); });
    const replay = await telegram.processUpdate(repo, input, () => { throw new Error('Duplicate dispatch'); });
    assert.equal(replay.duplicate, true);
    assert.equal((await repo.pool.query('SELECT count(*)::int n FROM application_outcomes WHERE application_id=$1', [seeded.application])).rows[0].n, 1);
  });
  await t.test('poison user reply is rejected durably while foreign chat cannot mutate data', async () => {
    const invalid = await telegram.processUpdate(repo, update(300, 'no correlated reply'), () => {});
    assert.equal(invalid.outcome, 'REJECTED'); assert.equal(invalid.error_code, 'REPLY_REQUIRED');
    assert.equal(await getTelegramPollingCursor(repo), 301);
    await assert.rejects(telegram.acceptDurably(repo, update(301, '/pause', null, 999)), /Unauthorized/);
    assert.equal(await row(301), undefined); assert.equal(await getTelegramPollingCursor(repo), 301);
    await telegram.processUpdate(repo, update(301, '/pause'), async () => ({ paused: true }));
    assert.equal((await repo.pool.query('SELECT paused FROM runtime_control WHERE id=true')).rows[0].paused, true);
  });
  await t.test('an audit database failure rolls back answer, ledger and cursor together', async () => {
    const seeded = await seed(); const before = await getTelegramPollingCursor(repo); const original = repo.pool;
    repo.pool = { connect: async () => {
      const client = await original.connect();
      return { query: (sql, args) => sql.startsWith('INSERT INTO events')
        ? Promise.reject(new Error('Fixture database event failure')) : client.query(sql, args), release: () => client.release() };
    } };
    try { await assert.rejects(telegram.acceptDurably(repo, update(400, 'answer', seeded.question.telegram_message_id)), /database event failure/); }
    finally { repo.pool = original; }
    assert.equal((await repo.pool.query('SELECT answered_at FROM application_questions WHERE question_id=$1', [seeded.question.question_id])).rows[0].answered_at, null);
    assert.equal(await row(400), undefined); assert.equal(await getTelegramPollingCursor(repo), before);
  });
  await t.test('committed never-started work recovers after adapter restart and never repeats', async () => {
    const seeded = await seed(); await telegram.acceptDurably(repo, update(500, 'answer', seeded.question.telegram_message_id));
    assert.equal((await row(500)).dispatch_status, 'PENDING');
    const restarted = new Telegram({ token: 'fixture-token', chatId: '123' }); let count = 0;
    const recovered = await restarted.recoverPending(repo, async accepted => { count++; assert.equal(accepted.application_id, seeded.application); });
    assert.equal(recovered.recovered.length, 1); assert.equal(count, 1);
    await restarted.recoverPending(repo, () => { throw new Error('Must not repeat completed work'); });
    assert.equal(await getTelegramPollingCursor(repo), 501);
  });
  await t.test('started or ambiguous dispatch remains reconciliation-only after crash/error', async () => {
    await telegram.acceptDurably(repo, update(600, '/status'));
    await repo.pool.query("UPDATE telegram_processed_updates SET dispatch_status='RUNNING',dispatch_started_at=now() WHERE update_id=600");
    const recovery = await telegram.recoverPending(repo, () => { throw new Error('Started work must not replay'); });
    assert.ok(recovery.attention.some(item => Number(item.update_id) === 600));
    const result = await telegram.processUpdate(repo, update(700, '/status'), () => { throw new Error('Ambiguous outbound fixture-token URL'); });
    assert.equal(result.dispatch_status, 'MANUAL_RECONCILIATION');
    let replayed = false; await telegram.processUpdate(repo, update(700, '/status'), () => { replayed = true; });
    assert.equal(replayed, false); assert.equal((await row(700)).dispatch_error_code, 'DISPATCH_FAILED_OR_AMBIGUOUS');
  });
  await t.test('poller keeps failed delivery cursor, rereads durable restart offset and omits messages from logs', async () => {
    const offsets = []; const logs = []; const input = update(800, '/pause');
    const fetchImpl = async (_url, options) => { offsets.push(JSON.parse(options.body).offset);
      return new Response(JSON.stringify({ ok: true, result: [input] })); };
    await assert.rejects(pollTelegramOnce({ telegram, repository: repo, fetchImpl, deliver: async () => { throw new Error('Core unavailable'); } }), /Core unavailable/);
    assert.equal(await getTelegramPollingCursor(repo), 701);
    await pollTelegramOnce({ telegram, repository: repo, fetchImpl, logger: event => logs.push(event),
      deliver: input => telegram.processUpdate(repo, input, async () => ({})) });
    await pollTelegramOnce({ telegram, repository: repo, fetchImpl, deliver: () => { throw new Error('Older updates must be ignored'); } });
    assert.deepEqual(offsets, [701, 701, 801]);
    const foreign = update(801, 'fixture-private-foreign-answer', null, 999);
    await pollTelegramOnce({ telegram, repository: repo, fetchImpl: async () => new Response(JSON.stringify({ ok: true, result: [foreign] })),
      logger: event => logs.push(event), deliver: () => { throw new Error('Foreign chat forwarded'); } });
    assert.equal(await getTelegramPollingCursor(repo), 802); assert.equal((await row(801)).outcome, 'IGNORED_UNAUTHORIZED_CHAT');
    assert.ok(!JSON.stringify(logs).includes('fixture-private')); assert.ok(!JSON.stringify(logs).includes('fixture-token'));
  });
  await t.test('actual core endpoints require service authentication and production update correlation', async () => {
    await repo.pool.query('UPDATE runtime_control SET paused=false WHERE id=true');
    const previousFill = process.env.APPLICATION_FILL_ENABLED; process.env.APPLICATION_FILL_ENABLED = 'false';
    const core = createCore({ repository: repo, token: 'fixture-service-token', port: 0, host: '127.0.0.1', telegramAdapter: telegram, testMode: false });
    await core.start(); const url = `http://127.0.0.1:${core.server.address().port}`;
    try {
      const call = (path, body, authorized = true) => fetch(url + path, { method: 'POST', headers: {
        'content-type': 'application/json', ...(authorized ? { 'x-jobhunter-token': 'fixture-service-token' } : {}),
      }, body: JSON.stringify(body) });
      assert.equal((await call('/telegram/update', update(900, '/pause'), false)).status, 401);
      assert.equal(await row(900), undefined);
      assert.equal((await call('/telegram/recover', {}, false)).status, 401);
      assert.equal((await call('/telegram/update', { message: { chat: { id: 123 }, text: '/pause' } })).status, 400);
      const seeded = await seed(); const answer = update(900, 'HTTP correlated answer', seeded.question.telegram_message_id);
      const first = await (await call('/telegram/update', answer)).json();
      assert.equal(first.result.durable, true); assert.equal(first.result.dispatch_status, 'COMPLETED');
      assert.equal(first.result.result.blocked_reason, 'APPLICATION_FILL_DISABLED');
      const replay = await (await call('/telegram/update', answer)).json(); assert.equal(replay.result.duplicate, true);
      const recovery = await (await call('/telegram/recover', { limit: 20 })).json(); assert.equal(recovery.ok, true);
      assert.equal((await repo.pool.query('SELECT count(*)::int n FROM events WHERE entity_id=$1 AND event_type=$2', [seeded.application, 'TELEGRAM_ANSWERED'])).rows[0].n, 1);
    } finally {
      await new Promise(resolve => core.server.close(resolve));
      if (previousFill === undefined) delete process.env.APPLICATION_FILL_ENABLED; else process.env.APPLICATION_FILL_ENABLED = previousFill;
    }
  });
});
