# Stage 6 — reporting and ledger module check

Module status: **PASS**, verified on 2026-10-03.
Acceptance order: **conditional until Stage 5 passes**.
Application statuses in this check are artificial seeded fixtures; no browser
submissions or real Telegram messages are sent.

Command: `node --env-file=.env scripts/test-stage-6.mjs --skip-bootstrap`.
Wrappers: `scripts/test-stage-6.ps1` / `sh scripts/test-stage-6.sh`.
Machine evidence: `tests/results/stage6.json`.

Real n8n workflow `WF06Fixture` called the authenticated core on port 3006.
Successful stored CLI executions **18** and **19** used dedicated PostgreSQL
schema `stage6_b47b4bc538c444939b28120d9fbb556e`.
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

CSV contains seven application rows; the Markdown submitted ledger contains
four distinct confirmation records. The second actual n8n execution returns
identical metrics, regenerates identical CSV and Markdown content, and leaves
the seven application rows unchanged. It does not append duplicate ledger rows.

Outputs remain isolated from the production ledger at
`data/report-fixtures/stage6_b47b4bc538c444939b28120d9fbb556e/`:
`summary.json`, `applications_log.csv`, `APPLICATIONS_LOG.md`.

This proves reconciliation/report generation from persisted state. It does not
prove upstream Stage 5 transitions, actual submitted applications, real Telegram
delivery, employer-response collection, full Stage 7 or production readiness.
