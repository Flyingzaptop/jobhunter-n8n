# Real discovery readiness smoke

OVERALL: PARTIAL

Start: 2026-10-03T18:46:17.269Z. End: 2026-10-03T18:49:57.359Z. Real submissions: 0.

Three configured official ATS adapters were fetched with public GET-only network guards and PostgreSQL normalization. Discovered: 407. Sources: greenhouse-canonical=310, lever-rivr=35, ashby-ashby=62. Model: qwen3.5:4b; real local Ollama, real candidate facts, no test gateway.

| Source | Sample role | Current feed state | Routing | Fit | Failure |
|---|---|---|---|---:|---|
| greenhouse-canonical | Graduate Customer Success Manager | OPEN | REJECT | 44.44 |  |
| lever-rivr | Mechanical Engineer (Junior) | OPEN | REJECT | 45.68 |  |
| ashby-ashby | Data Analytics Manager | OPEN | STRETCH | 50 |  |

- Graduate Customer Success Manager: https://job-boards.greenhouse.io/canonical/jobs/6103331
- Mechanical Engineer (Junior): https://jobs.lever.co/rivr/2b332a67-ca91-4f10-9c1a-452a9ad923e5
- Data Analytics Manager: https://jobs.ashbyhq.com/ashby/db46ff5d-e469-4bba-b8af-c55ac04f311f

CV: BLOCKED. Real candidate legal name UNKNOWN. No fixture identity or placeholder substituted.

- Real CV QA requires the candidate legal name from onboarding.
- Feed verification proves current publication, not a browser fill or real employer submission.

Detailed evidence: tests/results/real-readiness-smoke.json. Run: node --env-file=.env scripts/real-readiness-smoke.mjs.
