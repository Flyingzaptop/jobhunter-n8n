# Dashboard UI acceptance — real backend

Snapshot: **2026-10-04 10:04 Europe/Warsaw**. Dashboard:
`http://127.0.0.1:3020`.

**Live UI smoke: PASS — 22 checks, 19 actual screenshots, 0 API errors,
0 client JavaScript exceptions.** Frontend build/typecheck PASS; frontend
regression tests **12/12 PASS**; isolated dashboard security tests **14/14 PASS**.

All ten navigation views use the real authenticated PostgreSQL/core/browser API.
No responses were intercepted and no vacancy or employer page was fabricated.
**Real employer submissions during UI acceptance: 0.**

## Real-world UI evidence

Machine-readable evidence: `data/dashboard-v2/ui-smoke.json`.
Screenshots: `data/dashboard-v2/screenshots/` (local ignored artifacts).

- Real jobs pagination changed `1–30` to `31–60` across **13,911** persisted
  canonical vacancy records in this snapshot.
- The real Teamtailor posting
  `https://career.teamtailor.com/jobs/8124466-director-data-analytics` opened with its
  original source, freshness, and description. A real analyzed vacancy displayed
  **18 structured requirements**; clicking its cited fact opened the exact
  verified candidate source record.
- Actual source health/access states showed **155 configured catalog entries**,
  including LinkedIn and Pracuj. Catalog count is not operational-platform count.
- HITL rendered **20 actual unknown onboarding fields** after the backend fix.
  There is one persisted Telegram/candidate-profile answer workflow; dashboard
  answers and profile editing remain observation-only.
- Daily/cumulative analytics, explicit conversion outcomes, service health,
  versions, professional React/Django verification, and historical runs rendered.
- Pipeline/current action consume actual operations. A prior capture verified a
  real CV-factory RUNNING operation; current captures show the latest persisted
  states. No running-state animation or counter was simulated.
- Mobile navigation/overview at **390×844** had no document horizontal overflow.
  Escape closed the stage inspector and restored focus to its originating button.

## Independent CV QA is separate from identity/PDF readiness

The screenshot `11-real-cv-draft.png` is the exact real Canonical CV draft
`158d0b6b-4492-49bc-af2c-663bf3f70505`, generated with `gemma4:e2b-it-qat`.
The inspector and smoke assertions both confirm:

| Check | Actual persisted result |
| --- | --- |
| Independent claims QA | **PASS** |
| Candidate identity | **BLOCKED_IDENTITY** |
| PDF artifact | **NOT_RENDERED** |

The dashboard displays separate QA cards, tailored content, and source fact IDs.
It does not show an approved PDF or turn the identity blocker into a full CV PASS.
Other rejected diagnostic drafts remain visible as historical records and are not
used as accepted CV evidence. Exact record IDs prevent selecting a different
same-title diagnostic by accident.

## Actual browser observer

`14-active-browser.png` shows the real guarded Teamtailor session selected from the authenticated live catalog
`629bfdff-7dbf-4092-a1b8-4ade4091a387` at
`https://career.teamtailor.com/jobs/8124466-director-data-analytics/applications/new`.
The API detected **38 total page fields** (including cookie/hidden controls) in the final snapshot. The dashboard shows a
bounded scrollable field table, actual screenshot/URL/title, CAPTCHA detection,
observed field state, and human-readable recorded action.

The smoke observed **2 successive image responses**, verified actual PNG bytes
and `Cache-Control: no-store`, and confirmed polling stopped after leaving the
observer. No new PNG file appeared for that session in the configured browser
state directory during repeated observation. The delivered QA screenshot is an
explicit artifact, separate from the observer transport.

Backend observation uses in-memory screenshots and mask selectors for password,
OTP, and token inputs. The inspected actual public page had **3 matching protected
fields**; the authenticated snapshot returned `[redacted]` for all three, verified
by the smoke. No sensitive field was fabricated or filled for the test. Credential
and hidden-reasoning sanitization is also covered by isolated regression tests.

The final run supplied no browser UUID: five active real benchmark sessions were
discovered through `/api/browser-sessions`, labeled `ATS compatibility`, and the
actual Teamtailor session was selected from that dropdown. No application record
was fabricated. An operator can also observe an existing guarded session by exact
UUID. This is an authenticated read-only view; there is no browser debugging
interface or arbitrary remote-control action. Employer controls shown in the
screenshot are not interactive dashboard controls. Final submissions remain blocked.

## Remaining acceptance gap

No real employer application timeline existed in the inspected database snapshot.
Regression-only application records were excluded from real-world timeline proof.
The application ledger/inspector/timeline UI is implemented, but a real end-to-end
application timeline has not been demonstrated by this smoke run. This does not
make broader ATS/application production readiness PASS.

## Authentication and API regression checks

`tests/dashboard-security.test.mjs` uses the real HTTP server/auth implementation
with isolated admin-session persistence only. It creates no jobs or applications,
performs no browser/model/Telegram calls, and does not touch the operator's session.

The 14 checks cover unauthenticated 401, incorrect login, HttpOnly/Strict cookie,
hashed session/CSRF persistence, CSRF 403, GET control/logout 405, rejection of
arbitrary stages/commands/submit enablement, invalid artifact/session IDs,
cross-origin rejection, CSP, CSRF rotation, logout replay, expiration/login
backoff, and removal of credentials/hidden reasoning while retaining runtime data.

The actual live smoke also verified login, CSRF-authenticated logout, empty
localStorage/sessionStorage, and the visible/API-enforced dry-run mode.
`dist` and `node_modules` are ignored, verified with `git check-ignore`.

## Screenshots

| Artifact | Actual view |
| --- | --- |
| `01-overview.png` | Real counts, safety mode, health, pipeline/current action |
| `02-pipeline.png` | Six actual persisted stage states |
| `03-stage-inspector.png` | Actual discovery operation metadata |
| `04-jobs.png` | Real explorer and server pagination |
| `05-real-vacancy.png` | Actual Teamtailor posting and canonical links |
| `06-real-analysis.png` | Actual requirements, category scores, and routing |
| `07-candidate-fact.png` | Exact verified candidate source record |
| `08-applications.png` | Persisted ledger; no real-submit proof claimed |
| `10-cv-ledger.png` | Actual CV/draft states, including rejected diagnostics |
| `11-real-cv-draft.png` | Exact Gemma CV; claims PASS / identity BLOCKED / no PDF |
| `12-hitl-onboarding.png` | Actual pending candidate onboarding fields |
| `13-browser-observer.png` | Session selection/direct UUID observation |
| `14-active-browser.png` | Real Teamtailor session selected from catalog; compact 38-field table |
| `15-runs.png` | Actual operation history |
| `16-sources.png` | Real source catalog/access/health metrics |
| `17-analytics.png` | Today's persisted activity |
| `18-analytics-cumulative.png` | Cumulative activity and explicit outcomes |
| `19-system.png` | Health, versions, onboarding/provenance question |
| `20-responsive-overview.png` | Actual responsive 390px layout |

## Reproduce

With the backend running, from repository root (password stays in ignored `.env`):

```powershell
# Active ATS session is discovered automatically; no browser UUID needed
$env:DASHBOARD_CV_ID = '158d0b6b-4492-49bc-af2c-663bf3f70505'
node --env-file=.env scripts/dashboard-ui-smoke.mjs
node --test tests/dashboard-security.test.mjs
```

A real ATS browser session must still be active to reproduce observer checks; the dropdown reads the live authenticated catalog. Set DASHBOARD_BROWSER_SESSION_ID only to inspect a specific known session. The CV
record is persisted. Omit either optional ID to inspect other available real
records; unavailable real application/session evidence remains explicitly absent.

Frontend checks from `services/dashboard/web`:

```powershell
npm ci
npm test
npm run build
```

Deterministic frontend/auth regression tests are separate from the real dashboard
acceptance above. The existing mock job board was neither used nor extended as
proof for this dashboard run.
