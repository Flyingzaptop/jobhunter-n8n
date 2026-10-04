# Local Control Center

From the repository root, install/build the frontend once:

```powershell
npm --prefix services/dashboard/web ci
npm run dashboard:build
npm run migrate
npm run dashboard
```

Open http://127.0.0.1:3020. Set `DASHBOARD_PASSWORD` in the ignored `.env` to a private value of at least 16 characters. Sessions use HttpOnly cookies and CSRF protection. The server binds to localhost and rejects unexpected Host and Origin headers.

PostgreSQL, core, browser service, n8n and Ollama must be running for their corresponding views/actions. Missing services and unknown onboarding facts appear explicitly. Data comes from persisted real jobs, analyses, CV drafts, events and operation runs. Diagnostic rejected CV drafts remain marked ineligible. Empty application timelines are expected until genuine application preparation exists.

Stage controls invoke the existing n8n workflow IDs. Pause blocks new pipeline stage work; reporting remains available. Real submission cannot be enabled from the dashboard. Keep `DRY_RUN=true`, `ALLOW_REAL_SUBMIT=false`, `READINESS_REAL_SUBMIT_LOCK=true` for readiness runs.

The live browser observer fetches masked images only while its page is visible; backend images are generated in memory. Compatibility inspection results reside in `ats_compatibility_runs` and `tests/results/ats-real-v2.json`. This evidence is distinct from genuine application records.

Verification:

```powershell
node --env-file=.env --test --test-concurrency=1 tests/*.test.mjs
npm --prefix services/dashboard/web test
node --env-file=.env scripts/dashboard-ui-smoke.mjs
```

Mocks are regression fixtures only. Real-market discovery and actual ATS readiness limitations are recorded in the separate market and ATS reports.
