# Actual ATS compatibility evidence — 2026-10-04

Status: **PARTIAL**. This is a public vacancy inspection benchmark, not a claim of complete application automation.

Run `node --env-file=.env scripts/ats-real-benchmark.mjs`. Evidence is saved locally in `tests/results/ats-real-v2.json` and PostgreSQL `ats_compatibility_runs`. Each sample links a discovered real job and browser session; no synthetic employer or candidate was used.

| ATS | Actual result | Limitation |
| --- | --- | --- |
| Greenhouse | Canonical official vacancy opened; 38 visible fields detected | Real identity and a verified submission-ready CV are missing; no upload |
| Lever | Official posting and 17 visible fields detected | CAPTCHA requires manual takeover; no bypass |
| Ashby | Discovered official posting opened | Application form not reached under the current safe navigation policy |
| SmartRecruiters | Discovered official posting opened | Application form not reached under the current safe navigation policy |
| Teamtailor | No discovered official posting available for this run | Compatibility unverified |
| Workday | No discovered official posting available for this run | Compatibility unverified |

No candidate fields were filled in this run. No PDF was uploaded. Real employer submissions: **0**. `DRY_RUN=true`, `ALLOW_REAL_SUBMIT=false`, and the readiness lock remain enforced. A page opening alone is never counted as a compatible end-to-end application.

The browser permits only GET navigation and a narrowly validated Workday public vacancy-search POST. Candidate-data writes continue to require the final submission gate. Tests reject cross-origin navigation, required-field navigation, unreviewed payload keys and host suffix impersonation. Live observer images are masked and returned in memory without creating screenshot files.
