export const STATUSES = [
  "QUEUED",
  "OPENING",
  "FILLING",
  "NEEDS_USER",
  "CAPTCHA_WAIT",
  "MANUAL_TAKEOVER",
  "READY_TO_SUBMIT",
  "SUBMITTING",
  "SUBMITTED",
  "SUBMISSION_UNKNOWN",
  "FAILED",
  "SKIPPED",
  "ALREADY_APPLIED",
];
const edges = {
  QUEUED: ["OPENING", "SKIPPED", "ALREADY_APPLIED"],
  OPENING: ["FILLING", "FAILED", "MANUAL_TAKEOVER", "SKIPPED"],
  FILLING: [
    "NEEDS_USER",
    "CAPTCHA_WAIT",
    "MANUAL_TAKEOVER",
    "READY_TO_SUBMIT",
    "FAILED",
    "SKIPPED",
  ],
  NEEDS_USER: ["FILLING", "SKIPPED", "MANUAL_TAKEOVER"],
  CAPTCHA_WAIT: ["FILLING", "MANUAL_TAKEOVER", "SKIPPED"],
  MANUAL_TAKEOVER: ["FILLING", "SUBMITTED", "SUBMISSION_UNKNOWN", "SKIPPED"],
  READY_TO_SUBMIT: ["SUBMITTING", "SKIPPED", "FILLING", "MANUAL_TAKEOVER"],
  SUBMITTING: ["SUBMITTED", "SUBMISSION_UNKNOWN", "SKIPPED", "MANUAL_TAKEOVER"],
  SUBMISSION_UNKNOWN: ["SUBMITTED", "MANUAL_TAKEOVER"],
  FAILED: ["OPENING", "SKIPPED"],
  SUBMITTED: [],
  SKIPPED: [],
  ALREADY_APPLIED: [],
};
export function assertTransition(from, to) {
  if (!edges[from]?.includes(to))
    throw new Error(`Forbidden state transition: ${from} -> ${to}`);
}
export async function transition(repo, id, to, patch = {}) {
  const client = await repo.pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT * FROM applications WHERE application_id=$1 FOR UPDATE",
      [id],
    );
    if (!rows[0]) throw new Error("Application missing");
    assertTransition(rows[0].status, to);
    await client.query(
      `UPDATE applications SET status=$2,last_state=last_state || $3::jsonb,updated_at=now(),submit_blocked_reason=$4,skip_reason=$5,confirmation_id=COALESCE($6,confirmation_id),submitted_at=CASE WHEN $2='SUBMITTED' THEN now() ELSE submitted_at END WHERE application_id=$1`,
      [
        id,
        to,
        patch,
        patch.submit_blocked_reason ?? null,
        patch.skip_reason ?? null,
        patch.confirmation_id ?? null,
      ],
    );
    await client.query(
      `INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json) VALUES(gen_random_uuid(),'application',$1,$2,$3)`,
      [id, `STATE_${to}`, { from: rows[0].status, ...patch }],
    );
    // A human answer can finish the form after its send worker was parked.
    // Wake that existing task; its normal Gemma review and submit gates remain.
    if (to === 'READY_TO_SUBMIT') await client.query(
      "UPDATE continuous_work SET status='RETRY',next_retry_at=now(),updated_at=now() WHERE lane='auto-submit' AND entity_id=$1 AND status='WAITING_USER'",
      [id],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
