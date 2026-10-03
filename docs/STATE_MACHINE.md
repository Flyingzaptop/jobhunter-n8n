# Canonical application states

QUEUED, OPENING, FILLING, NEEDS_USER, CAPTCHA_WAIT, MANUAL_TAKEOVER,
READY_TO_SUBMIT, SUBMITTING, SUBMITTED, SUBMISSION_UNKNOWN, FAILED,
SKIPPED, ALREADY_APPLIED.

Dry-run final review is READY_TO_SUBMIT with dry_run=true and blocked_reason=DRY_RUN.
Closed jobs use SKIPPED with skip_reason=JOB_CLOSED. SUBMITTING records irreversible
intent before the browser action. Unknown outcome uses SUBMISSION_UNKNOWN and never
replays Submit. Evidence-confirmed completion moves to SUBMITTED. Manual recovery
is required for unresolved ambiguity.

Transitions are transactionally checked under SELECT FOR UPDATE. Audit events
are append-only via a PostgreSQL trigger. Recruiting outcomes are a separate table.
Global pause is persisted in runtime_control. Pending Telegram replies are linked
through message IDs and permitted chat IDs, not guessed application identifiers.
