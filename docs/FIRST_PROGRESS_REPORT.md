# First implementation handoff

Overall project status: **PARTIAL**. The six-workflow local core and complete mock
acceptance are functioning. This is not a completed live-employer rollout.

Repository: https://github.com/Flyingzaptop/jobhunter-n8n (private).

| Stage | Verified result |
|---|---|
| 1 Discovery | PASS: real n8n and PostgreSQL fixture persistence |
| 2 Normalization/dedupe | PASS: 7 raw → 4 canonical / 7 provenance links; rerun idempotent |
| 3 Fit | PASS: real local Qwen, deterministic scores, factual/source integrity; latest matching regressions 45/45 |
| 4 CV | PASS: 3 distinct factual PDFs; source IDs, text extraction and visual QA |
| 5 Application/HITL | PASS: persisted interruption/restart, correlated answers, dry-run stop, guarded submit |
| 6 Reporting | PASS: exact DB counts, separate daily/cumulative and weekly funnel, stable ledger |
| 7 Full system | PASS: 21 raw → 10 jobs → 10 real-model analyses → 1 confirmed mock application |

Final full Stage7 duration: 324.191 seconds. Natural ranking selected the
Mechanical R&D role at fit97.62, without a target-ID exception. The eight-step form
tested known contacts, actual PDF bytes/hash, an unknown date, PNG CAPTCHA relay,
dynamic fields, validation correction, consent, restart and exactly one backend
submit POST. The submission notification was emitted exactly once. Rendered PDF
manual review passed. All 23 tested source fingerprints match the delivered
business code. Latest local unit/integration suite: **80/80 PASS, zero skipped**.

Actual runtime: Node24.14.0, PostgreSQL18.4, n8n2.41.6, Ollama0.32.5,
`qwen3.5:4b`, local Chromium. Core/browser/n8n/PostgreSQL/Ollama health is green;
production Telegram credentials are absent. Six exported workflows are in
`n8n/workflows/`, initially unpublished. Queue handoff was also verified through
five distinct published isolated n8n test copies with zero model/application actions.

## Real discovery

Current permitted public ATS feeds produced407 persisted/normalized vacancies:
Greenhouse310, Lever35, Ashby62. The same three real sampled vacancies were
successfully analyzed using the real candidate fact store, with no semantic mock
or substituted identity. They span customer success, mechanical engineering and
data analytics. No real application was started or submitted.

`docs/REAL_DISCOVERY_SMOKE_REPORT.md` is **PARTIAL**, because the real legal name
is UNKNOWN and a real tailored CV cannot pass name QA. All other unknowns are
listed by `node scripts/onboarding.mjs`; identity/contact details, exact employment
dates, start availability and contractual/relocation preferences remain unknown.
The missing values are preserved and are never guessed from GitHub identity.

## Commands and locations

Windows startup from the workspace:

```powershell
.\scripts\start-local.ps1
```

Fresh installation/import and the exact final acceptance command:

```powershell
npm ci
npx playwright install chromium
ollama pull qwen3.5:4b
npm install --prefix .tools/n8n n8n@2.41.6 --no-audit --no-fund
node --env-file=.env scripts/n8n-bootstrap.mjs
.\scripts\test-stage-7.ps1 -SkipBootstrap
```

The startup script creates an ignored environment/profile seed if missing, but
does not publish workflows or enable applications. See README and OPERATIONS
for configuration. Docker's prepared startup command is `docker compose up -d --build`.

- Complete E2E report: `docs/STAGE_7_E2E_REPORT.md`.
- Real-source readiness report: `docs/REAL_DISCOVERY_SMOKE_REPORT.md`.
- Stage7 fixture ledger: `data/test-stage7/stage7_42706aa737754c38aee330cf8c8f0327/exports/APPLICATIONS_LOG.md`.
- Production ledger path: `data/exports/APPLICATIONS_LOG.md` (contains no real submissions).
- Stage7 CVs/screenshots/state: same isolated `data/test-stage7/SCHEMA/` root.
- Runtime logs/process metadata: `data/runtime/`.
- Latest machine results: `tests/results/` (ignored; contains private/runtime evidence).

## Remaining gates

Real submit remains disabled; application filling is disabled by default. The
domain allowlist is empty. Stage7 does not enable live mode automatically.
Docker/WSL are absent, so container startup is unverified. Telegram was exercised
through the real adapter with an isolated test transport; actual bot delivery
requires user-supplied credentials. No real CV is generated until the candidate
legal name is supplied.

Further implementation work remains for full Polish prose translation, motivation
and required cover letters, broader real ATS form compatibility, reusable-answer
approval UX and company-level density enforcement beyond its routing flags.
Current strict browser/network boundaries intentionally require manual takeover
for unsupported real POST/auth/document flows. Those limitations are recorded in
`docs/BROWSER_BOUNDARY_AND_LIMITATIONS.md`. The full master definition of done is
therefore not claimed.

Secrets, real candidate profile, CVs, browser cookies/state, screenshots and database
files are ignored by Git. Commits and CI are actively maintained in the remote
repository. The final handoff commit is reported in the chat rather than embedded
recursively in this report.
