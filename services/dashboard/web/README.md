# JobHunter Control Center frontend

React + TypeScript + Vite, served by the local dashboard backend on
`http://127.0.0.1:3020`. All state comes from authenticated same-origin `/api`
endpoints. The UI has no demonstration data or service credentials.

From this directory:

```powershell
npm ci
npm test
npm run build
```

For local frontend development, `npm run dev` proxies `/api` to the dashboard
backend on port 3020. The compiled `dist` directory is served by that backend.
The login password must be configured on the server; never add it to a Vite
environment variable. Session credentials use an HttpOnly cookie. CSRF tokens
are held in memory only, and supplied to bounded control requests.

The named SSE `update` event refreshes visible records with a short debounce.
A 30-second fallback refreshes when the document is visible. Browser observation
refreshes metadata and an in-memory image every 2 seconds only while the observer
is mounted and the document is visible. No screenshots are saved by the frontend.
The observer reads actual application sessions and the authenticated
`/api/browser-sessions` ATS compatibility ledger. Benchmark entries are labeled
`ATS compatibility`, never turned into application records. A known active
guarded session can also be observed by its exact UUID.

The dashboard observes onboarding blockers and accepts explicitly reviewed user
answers on eligible persisted HITL questions, using the same durable correlation
and single-answer mechanism as Telegram. Candidate profile edits, CAPTCHA, and
authentication remain manual. Specific application approvals bind a fresh
job/profile/CV/form digest and are preparation-only; global production evidence
and existing Submit safeguards remain mandatory. There is no
real-submit enablement control, arbitrary code/URL control, or remote browser
debugging interface. Vacancy descriptions are rendered as plain text. External
links accept only HTTP(S) URLs.

API contracts: `docs/READINESS_V2_CONTRACTS.md`; current HITL/review additions:
`docs/DASHBOARD_HITL_GATES.md`. Missing/null fields are presented
as unknown or not recorded. A failed refresh explicitly marks previous records
as potentially stale. Conversion never infers outcomes from silence.
