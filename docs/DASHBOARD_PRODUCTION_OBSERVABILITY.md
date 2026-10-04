# Production gate observability — gate in progress

Actual snapshot: 2026-10-04 13:51 Europe/Warsaw. The System page now reads
authenticated `/api/production-gate` and `/api/relevance-queue`.

**Production gate status: PARTIAL.** This document does not claim production
readiness, final Submit permission, or completed calibration.

The eight checklist states and counter cards are taken from persisted API
evidence. Unknown evidence never becomes PASS. The snapshot showed 3 qualifying
fit jobs toward the required 200, 0 employer-ready CV jobs, 20 recorded review
labels with calibration still pending, and 0 ATS final-review rehearsals.
Telegram delivery and real-profile dashboard HITL validation remained blocked.

The relevance section showed 50 actual persisted job rows and 10 actual model
invocations. Counts in that snapshot: ANALYZED 6, CLOSED 5, LOW_PRIORITY 13,320,
OPEN_UNVERIFIED 1, QUEUED 578, RUNNING 1. These counters are screening/workflow
states, not qualified applications. The UI explicitly states:

`QUEUED / relevance score ≠ fit-qualified`.

Rows link to the existing vacancy inspector. Indexing reasons are available in
bounded expandable details; the queue table scrolls without growing the whole
page. Passing a checklist item does not enable Submit. There is no production
submission toggle or new execution control in this section.

While System is visible, both resources refresh every 5 seconds and on existing
SSE updates. The timer stops when navigating away; hidden documents skip refresh.
Failed API requests remain visibly unavailable/stale instead of showing invented
successful checks or empty evidence.

## Verified UI behavior

`node --env-file=.env scripts/dashboard-production-ui-smoke.mjs` passed all four
live read-only checks with 0 JavaScript exceptions and 0 employer submissions:

- all eight rendered statuses matched actual `checks[].pass` values;
- persisted queue rows and model invocation count matched their actual API;
- both resources refreshed within five seconds while the view was active;
- both stopped polling after navigation.

This is a **UI behavior PASS**, separate from the **PARTIAL production gate**.
Frontend build/typecheck passed; frontend regression tests passed 13/13.

Two new actual screenshots preserve the earlier dashboard acceptance captures:

- `data/dashboard-v2/screenshots/21-production-gate.png`
- `data/dashboard-v2/screenshots/22-relevance-queue.png`

Machine-readable live check:
`data/dashboard-v2/production-ui-smoke.json`.

No fake API responses, candidate fit results, model invocations, or evidence were
created for this verification. These are snapshots of ongoing work; counts may
increase as the independently running analysis batch progresses.
