# Stage 6 — reporting and ledger module check

Module status: **PASS**, verified on 2026-10-03.
Acceptance order: **conditional until Stage 5 passes**.
Application statuses in this check are artificial seeded fixtures; no browser
submissions or real Telegram messages are sent.

Command: `node --env-file=.env scripts/test-stage-6.mjs --skip-bootstrap`.
Wrappers: `scripts/test-stage-6.ps1` / `sh scripts/test-stage-6.sh`.
Machine evidence: `tests/results/stage6.json`.

Real n8n workflow `WF06Fixture` called the authenticated core on port 3006.
Successful stored CLI executions **64** and **65** used dedicated PostgreSQL
schema `stage6_66007ed7fca94c5f87175f6f958bce17`.
An explicitly injected Telegram capture transport validates the exact message
content. Real Telegram bot delivery remains unverified.

Seeded database counts, returned metrics and captured summary agree:

| Metric | Count |
|---|---:|
| Discovered | 30 |
| Unique vacancies | 24 |
| Analyzed vacancies | 24 |
| Suitable/actionable | 7 |
| Submitted fixture statuses | 4 |
| Awaiting user | 1 |
| Failed | 1 |
| Skipped | 1 |

Decision bands are AUTO_APPLY 4, REVIEW 2, STRETCH 1, REJECT 17.
Four fixture applications have NO_RESPONSE outcomes. No CVs are seeded.
The same numbers are checked separately in the Warsaw daily section; legacy
top-level fields are explicitly cumulative. The weekly cohort contains four
submitted/pending applications, attributed to AUTO_APPLY before submission.
The sample is below the default five-application threshold, so no small-group
conversion rates are published. All 24 fixture work formats remain UNKNOWN.

CSV contains seven application rows; the Markdown submitted ledger contains
four distinct confirmation records. The second actual n8n execution returns
identical reporting metrics, regenerates identical CSV and Markdown content, and leaves
the seven application rows unchanged. It does not append duplicate ledger rows.
Reconciliation keeps identical action evidence, records zero new events on rerun,
and makes zero automatic submissions. Its run timestamp is expected to change.

Outputs remain isolated from the production ledger at
`data/report-fixtures/stage6_66007ed7fca94c5f87175f6f958bce17/`:
`summary.json`, `weekly_conversion.json`, `applications_log.csv`, `APPLICATIONS_LOG.md`.
CSV includes the six work-format/employment-eligibility fields. Files are
replaced atomically individually, preserving complete-file reads.

Five additional reporting tests pass with PostgreSQL on 127.0.0.1:55432:
Warsaw midnight/DST, explicit distinct outcome history and old-cohort activity,
policy geography buckets, historical submission attribution and required CSV
eligibility fields, and the original 30/24/7/4 reconciliation fixture.
Run: `node --env-file=.env --test --test-concurrency=1 tests/reporting.test.mjs tests/reporting-periods.test.mjs`.
Period definitions and production limitations: `docs/REPORTING.md`.

This proves reconciliation/report generation from persisted state. It does not
prove upstream Stage 5 transitions, actual submitted applications, real Telegram
delivery, employer-response collection, full Stage 7 or production readiness.
