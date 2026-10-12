import fs from 'node:fs/promises';
import path from 'node:path';

// A click is not transport evidence. Persist intent before the first unreviewed
// write leaves the browser; an interrupted request must never become retryable.
export async function recordSubmitTransport(session, root, state, extra = {}) {
  const record = {application_id:session.application_id,browser_session_id:session.id,
    state,observed_at:new Date().toISOString(),...extra};
  const target = path.join(root, `${session.id}-submit-transport.json`);
  await fs.writeFile(`${target}.tmp`, JSON.stringify(record), {mode:0o600});
  await fs.rename(`${target}.tmp`, target);
  session.submitTransport = record;
  return record;
}
export function undispatchedCaptcha(session, view) {
  return view.captcha === true && session.submitTransport?.state === 'NOT_DISPATCHED';
}
