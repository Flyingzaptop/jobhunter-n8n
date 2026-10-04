# Telegram durable input and dispatch

The PostgreSQL cursor in migration 002 is now used by the poller. Migration 004
adds correlated dispatch state and chat-scoped question IDs. An allowed update
atomically commits its answer/outcome/pause change, answer audit event, unique
`update_id` receipt and `next_update_id`. A database failure rolls everything
back. Replayed updates never reapply a candidate answer or append the same
outcome/audit event twice. Unknown questions and invalid user commands receive
durable REJECTED receipts so a poison update cannot block subsequent messages.

The polling script reads the cursor from PostgreSQL on every iteration; it never
advances an in-memory offset before delivering to core. Network/core failures
stop the current batch. Foreign chats are discarded with a durable ignored ID,
without applying any application/question mutation or storing message contents.
Telegram confirms older updates when `getUpdates` receives a higher offset;
see the [official getUpdates contract](https://core.telegram.org/bots/api#getupdates).

Input effects are exactly once in PostgreSQL. External Telegram/browser work
cannot share a distributed transaction. A committed dispatch starts through an
atomic PENDING →RUNNING claim. Never-started PENDING work can recover after a
restart. COMPLETED work is not repeated. RUNNING after a crash, or an exception
after dispatch starts, requires reconciliation; no guessed lease timeout or
automatic ambiguous re-send is introduced. Existing submission state guards
still apply, with real submissions disabled for this milestone.

Only application/question IDs, commands and outcome status are stored in the
dispatch correlation. Raw Telegram messages/answers/token URLs are omitted from
logs and the duplicate ledger. Answers remain in the existing retained question
store. A reply must match both the pending Telegram message ID and configured
chat ID. Old questions without a known chat correlation must be manually
reconciled; they are not silently mapped to the current chat.

This local setup supports one configured bot/cursor per database. Replacing the
bot or changing its allowed chat requires reviewed migration/reconciliation of
pending work, not automatic cursor deletion. Missing credentials still block live
Telegram operation. Deterministic adapter/PostgreSQL tests do not prove live bot
delivery when credentials are absent.

## Required core wiring (root owns server edits)

Extract the existing post-accept command/application behavior into this helper
inside `createCore` (it uses the existing `repository`, `stage`, `telegram`, and
`telegramAdapter` bindings):

```js
async function dispatchTelegram(accepted) {
  const adapter = telegramAdapter ?? telegram;
  if (accepted.application_id) {
    const row = (await repository.pool.query(
      'SELECT job_id FROM applications WHERE application_id=$1',
      [accepted.application_id],
    )).rows[0];
    if (!row) throw new Error('Correlated application missing');
    return stage(5, { job_id: row.job_id, application_id: accepted.application_id });
  }
  if (accepted.command === '/summary') return stage(6);
  if (accepted.command === '/weekly') return stage(6, { weekly: true });
  if (accepted.command === '/status') {
    const rows = (await repository.pool.query(
      'SELECT status,count(*)::int AS count FROM applications GROUP BY status',
    )).rows;
    const paused = (await repository.pool.query(
      'SELECT paused FROM runtime_control WHERE id=true',
    )).rows[0]?.paused;
    await adapter.send(`JobHunter status\nPaused: ${Boolean(paused)}\n${rows.map(r => `${r.status}: ${r.count}`).join('\n')}`);
    return { paused: Boolean(paused), statuses: rows };
  }
  if (['/pause', '/resume'].includes(accepted.command)) {
    await adapter.send(accepted.command === '/pause'
      ? 'JobHunter paused. Saved application state is retained.'
      : 'JobHunter resumed. Queue processing is enabled.');
  }
  return accepted;
}
```

Replace the existing `/telegram/update` route body and add recovery, after the
same existing service-token authentication and bounded body parser:

```js
if (req.method === 'POST' && req.url === '/telegram/update') {
  const adapter = telegramAdapter ?? telegram;
  const result = testMode && body.update_id === undefined
    ? await dispatchTelegram(await adapter.accept(repository, body))
    : await adapter.processUpdate(repository, body, dispatchTelegram);
  return send(200, { ok: true, result });
}
if (req.method === 'POST' && req.url === '/telegram/recover') {
  const result = await (telegramAdapter ?? telegram).recoverPending(
    repository, dispatchTelegram, { limit: body.limit ?? 20 },
  );
  return send(200, { ok: true, result });
}
```

The no-update-ID branch is only for existing explicitly configured test-mode
regressions. Real polling requires a valid safe-integer Telegram update ID and a
durable core receipt. `scripts/telegram-poll.mjs` calls recovery before polling;
it records only attention counts for RUNNING/MANUAL_RECONCILIATION work.

The dashboard can expose unresolved delivery state with a bounded read-only query:

```sql
SELECT update_id,outcome,dispatch_status,dispatch_error_code,processed_at,
       dispatch_started_at,correlation_json
FROM telegram_processed_updates
WHERE dispatch_status IN ('PENDING','RUNNING','MANUAL_RECONCILIATION')
ORDER BY processed_at LIMIT 100;
```

Run migrations before loading new code. Verification commands:

```powershell
node --env-file=.env scripts/migrate.mjs
node --env-file=.env --test tests/telegram-durable.test.mjs
node --test tests/telegram.test.mjs tests/priority-retry-v2.test.mjs
```
