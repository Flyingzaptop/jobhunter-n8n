# JobHunter readiness v2 — 2026-10-04

**STATUS: PARTIAL**. Real-market discovery, authenticated observation and grounded content generation are implemented. Complete automatic Polish-source coverage and a complete real ATS application rehearsal remain unverified or blocked.

## REAL-WORLD TESTS

- Actual discovery: initial full run attempted 27 platforms, 13 operational; 123 official employer feed endpoints attempted, 74 valid boards (68 nonempty). Full discovery produced 13,737 raw records and 13,707 unique vacancies. A subsequent actual query/geography run added 201 canonical jobs. The final bounded Teamtailor extension added three verified actual postings (13,911 canonical jobs). Employer display strings are not verified legal-entity counts. Broad indexing hints are not candidate relevance scores.
- Required Polish sources: JustJoinIT and RocketJobs operational. Pracuj/OLX access errors, NoFluffJobs robots restrictions and LinkedIn access restrictions remain explicit. Authentication/manual fallback labels do not imply operational automated access. See [source report](REAL_MARKET_V2_REPORT.md).
- Actual job analyses use official descriptions, source citations and real profile facts. Scores, eligibility and unknown facts remain separate. Canonical is REVIEW rather than an automatically eligible application. Rejected/diagnostic postings never enter the application queue.
- Current latest decisions cover 14 distinct actual jobs: 10 REJECT, 2 REVIEW, 2 STRETCH, 0 AUTO_APPLY. This is an analyzed subset; relevance for the remaining market is UNKNOWN. REVIEW/STRETCH does not establish employment eligibility or submission readiness.
- CV: separate real local writer/verifier calls. The bounded Gemma comparison passed factual claim QA for four drafts: one Canonical REVIEW context and three explicitly rejected diagnostic contexts. Default Qwen failures remain recorded. Every draft remains identity-blocked; no submission-ready PDF exists. Three rejected drafts are excluded from suitable-vacancy acceptance. See [real CV report](CV_V2_REAL_REPORT.md).
- ATS: current official freshness checked before inspection. Greenhouse and Teamtailor forms detected, Lever CAPTCHA/manual takeover, Ashby and SmartRecruiters posting pages reached but application forms not reached. Workday remains manual fallback after invalid robots response. Zero fields filled, zero uploads. See [ATS report](ATS_REAL_V2_REPORT.md).
- Dashboard: actual PostgreSQL data, ten views, authenticated cookies/CSRF, live operation events, fact/claim evidence and browser images. Real browser UI acceptance passed with no JavaScript/API errors. Empty genuine application timelines are shown honestly. See [UI report](DASHBOARD_UI_REPORT.md).
- Actual dashboard control: the first real n8n run exposed unpublished child workflows. Published manual-only copies fixed the transition. A repeat executed stages 2→3→4→5 on real queues, including three real model-based fit analyses; CV queue was empty and application filling remained explicitly disabled. Invocation/queue handoff PASS is distinct from application readiness. Evidence: `tests/results/dashboard-control-real-v2.json`.

**Real employer submissions: 0.** `DRY_RUN=true`, `ALLOW_REAL_SUBMIT=false`, `READINESS_REAL_SUBMIT_LOCK=true`. No new fake job board was created.

## MOCK / REGRESSION TESTS

The final complete local PostgreSQL/Chromium regression run passed **146/146 tests**, zero failures and zero skips. Log: `tests/results/regression-readiness-v2.txt`. Frontend tests passed **12/12**, TypeScript/Vite build passed, and actual browser UI checks passed **22/22**. Synthetic named PDFs and mock Submit tests validate code paths only and are excluded from real-world readiness evidence. GitHub CI passed the discovery, control-center and orchestration commits.

## Remaining readiness blockers

1. Real legal name, email and phone are unknown. Work authorization, hiring route, salary, availability and other onboarding answers remain unknown where not supplied.
2. Full automated access to all mandatory Polish platforms/LinkedIn is not established. Restrictions are not bypassed.
3. Actual ATS end-to-end fill/upload/navigation is incomplete; no form opening is counted as a full compatibility PASS.
4. Most of the broad market has not been individually fit-analyzed. The count of indexed roles must not be presented as suitable vacancies.
5. Real Telegram delivery needs configured operator credentials; durable processing tests are distinct from verified delivery.

## Reproduce and inspect

See [local setup](CONTROL_CENTER_SETUP.md). `node --env-file=.env scripts/readiness-status.mjs` captures actual current counts, runs and local evidence summaries in `tests/results/readiness-status-v2.json`. Real discovery, CV and ATS evidence lives under ignored `tests/results`; screenshots and drafts live under ignored `data`. These artifacts contain local working evidence and are not committed with private facts.

Remote repository: https://github.com/Flyingzaptop/jobhunter-n8n. Implementation commits: `14bac04` (real discovery and fit extraction), `0cc8851` (Control Center, CV factory and dry-run observation). Later commits record final integration and verification.
