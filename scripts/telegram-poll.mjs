import { pathToFileURL } from 'node:url';
import { Telegram, getTelegramPollingCursor, acknowledgeIgnoredTelegramUpdate } from '../services/core/telegram.mjs';
import { Repository } from '../services/core/repository.mjs';

export async function pollTelegramOnce({ telegram, repository, fetchImpl = fetch,
  deliver, signal, logger = () => {} } = {}) {
  const offset = await getTelegramPollingCursor(repository);
  const response = await fetchImpl(`https://api.telegram.org/bot${telegram.token}/getUpdates`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offset, timeout: 30, allowed_updates: ['message'] }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(40000)]) : AbortSignal.timeout(40000),
  });
  const envelope = await response.json();
  if (!response.ok || !envelope.ok || !Array.isArray(envelope.result)) throw new Error('TELEGRAM_POLL_FAILED');
  const updates = envelope.result.slice().sort((a, b) => a.update_id - b.update_id);
  let delivered = 0; let ignored = 0;
  for (const update of updates) {
    if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) throw new Error('INVALID_TELEGRAM_UPDATE_ID');
    if (update.update_id < offset) continue;
    if (signal?.aborted) throw new Error('TELEGRAM_POLL_CANCELLED');
    if (String(update.message?.chat?.id) !== telegram.chatId) {
      await acknowledgeIgnoredTelegramUpdate(repository, update.update_id); ignored++; continue;
    }
    // Only core's atomic receipt advances the durable cursor. An uncertain HTTP
    // request can be redelivered without reapplying the answer or outcome.
    const receipt = await deliver(update);
    if (!receipt?.durable || receipt.update_id !== update.update_id) throw new Error('TELEGRAM_DURABLE_RECEIPT_REQUIRED');
    delivered++;
    logger({ event: 'telegram_update_received', update_id: update.update_id, outcome: receipt.outcome,
      dispatch_status: receipt.dispatch_status, duplicate: Boolean(receipt.duplicate) });
  }
  return { delivered, ignored, next_update_id: await getTelegramPollingCursor(repository) };
}

export async function runTelegramPolling({ telegram, repository, coreToken, fetchImpl = fetch,
  signal, sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)), logger = console.log } = {}) {
  if (!telegram?.token || !telegram.chatId) throw new Error('Telegram onboarding required');
  if (!coreToken) throw new Error('CORE_SERVICE_TOKEN required');
  const core = async (path, payload) => {
    const response = await fetchImpl(`http://127.0.0.1:3000${path}`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-jobhunter-token': coreToken },
      body: JSON.stringify(payload), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000) });
    if (!response.ok) throw new Error('CORE_TELEGRAM_DELIVERY_FAILED');
    const envelope = await response.json();
    if (!envelope.ok) throw new Error('CORE_TELEGRAM_DELIVERY_FAILED');
    return envelope.result;
  };
  logger({ event: 'telegram_polling_started', note: 'Token and message contents omitted from logs; durable cursor enabled' });
  while (!signal?.aborted) {
    try {
      const recovery = await core('/telegram/recover', { limit: 20 });
      if (recovery?.attention?.length) logger({ event: 'telegram_dispatch_attention', count: recovery.attention.length });
      await pollTelegramOnce({ telegram, repository, fetchImpl, signal, logger,
        deliver: update => core('/telegram/update', update) });
    } catch (error) {
      if (signal?.aborted) break;
      logger({ event: 'telegram_poll_error', error: /^[A-Z_]+$/.test(error.message) ? error.message : error.name });
      await sleepImpl(5000);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repository = new Repository(); const telegram = new Telegram(); const controller = new AbortController();
  process.on('SIGINT', () => controller.abort()); process.on('SIGTERM', () => controller.abort());
  try {
    await repository.migrate();
    await runTelegramPolling({ telegram, repository, coreToken: process.env.CORE_SERVICE_TOKEN,
      signal: controller.signal, logger: event => console.log(JSON.stringify(event)) });
  } finally { await repository.close(); }
}
