# JobHunter

Local job discovery and application system using six n8n workflows, PostgreSQL,
Ollama and an authenticated Playwright service. Development is in progress.
The user clarifications in `docs/IMPLEMENTATION_CLARIFICATIONS.md` override
ambiguities in `docs/MASTER_SPEC_v2.md`.

## Current verification scope

Readiness v2 adds a broad real-market catalog, official freshness checks,
grounded CV rewrites with independent claim verification, durable Telegram
processing and an authenticated React Control Center. The 2026-10-04 snapshot
contains 13,911 actual canonical vacancies. Real Greenhouse and Teamtailor forms
were inspected; other ATS and mandatory-platform limitations remain explicit.
Fit analysis uses schema-validated local Ollama, deterministic scores and fact IDs.

See [real-world readiness report](docs/REAL_WORLD_READINESS_V2_REPORT.md) and
[Control Center setup](docs/CONTROL_CENTER_SETUP.md). Run `npm run dashboard`
after building its frontend. Local dashboard: http://127.0.0.1:3020.

The next [Production Readiness Gate](docs/PRODUCTION_READINESS_GATE.md) is active:
real local identity, transparent relevance queue, larger real Qwen batches,
source-labelled calibration, employer-ready PDFs, ATS final-review rehearsals,
actual Telegram delivery and dashboard HITL. Per-application review approvals
do not enable Submit; the first ten actual applications require confirmation.

All six baseline workflows and mock Stage 7 passed with real n8n, PostgreSQL, local Ollama and Chromium; mocks remain regression evidence only. See docs/STAGE_7_E2E_REPORT.md. A real Control Center n8n invocation also passed through stages 2→3→4→5 with filling disabled. Production readiness remains partial: real identity/PDF readiness, complete platform/ATS compatibility, live Telegram delivery and Docker deployment are not verified.
Do not enable real submission. No successful unit test implies Stage 7 PASS.

## Requirements

- Node.js 24 for native local development.
- Docker and Docker Compose for the production stack.
- Local LM Studio / Gemma; target hardware: 6 GB VRAM / 40 GB RAM.
- Telegram bot token and allowed chat ID for actual human interaction.

## Windows local development

For the configured workspace, start every service hidden and independently of Codex:

```powershell
npm start
```

The launcher uses Windows WMI with hidden startup settings. Repeated launches reuse
one supervisor. Closing the invoking terminal or Codex does not own these service
processes. Logs and health state are in `data/runtime/`; the dashboard is at
`http://127.0.0.1:3020`. `scripts/start-local.ps1` uses the same launcher.
No scheduled task is required. The laptop must remain awake for processing.
The supervisor waits for PostgreSQL SQL readiness before starting dependent services.

`.env` is ignored; generated secrets are never printed. Local PostgreSQL binds
to 127.0.0.1:55432 and stores its cluster under `data/local-postgres/`.
Core binds to 127.0.0.1:3000; browser to 127.0.0.1:3001.

## Native n8n bootstrap and stage acceptance

With PostgreSQL running and `.env` initialized:

```powershell
npm install --prefix .tools/n8n n8n@2.41.6
node --env-file=.env scripts/n8n-bootstrap.mjs
node --env-file=.env scripts/local-n8n.mjs
```

Native n8n uses the `n8n` PostgreSQL schema and `data/n8n/` user folder.
Bootstrap imports the HTTP header credential from `.env` and removes its
temporary plaintext file, then imports six inactive workflows with the local
core URL. `npm start` starts the complete hidden stack. The n8n editor is at
`http://127.0.0.1:5678`; health is `http://127.0.0.1:5678/healthz`.
The continuous worker handles execution; leave scheduled workflows inactive.

For isolated Stage 1/2 acceptance, stop the local n8n server and core first:

```powershell
./scripts/test-stage-1.ps1
./scripts/test-stage-2.ps1
```

Linux/macOS wrappers are `sh scripts/test-stage-1.sh` and
`sh scripts/test-stage-2.sh`. After bootstrap, `-SkipBootstrap` on PowerShell
or `--skip-bootstrap` on Node/sh skips repeated imports. Tests start an
authenticated core on port 3000 and invoke real n8n CLI executions. Each run
creates a dedicated PostgreSQL schema, retained for inspection, without touching
production job tables. Results are `tests/results/stage1.json` and `stage2.json`;
summaries are `docs/STAGE_1_REPORT.md` and `docs/STAGE_2_REPORT.md`.
Fixtures are available only when core is constructed in explicit test mode.

Additional isolated module checks:

```powershell
./scripts/test-stage-4.ps1 -SkipBootstrap
./scripts/test-stage-6.ps1 -SkipBootstrap
```

These execute real n8n workflows against dedicated PostgreSQL schemas, with
fictional profile/seeded analysis and application statuses. Stage 4 uses core
port 3004, Stage 6 uses 3006, and fixture task brokers use ports 5801–5806 so the
native editor can remain running. Stage 4 requires Chromium and Poppler
`pdftoppm` and produces three factual PDF variants; Stage 6 captures Telegram
summary text with a test transport and writes to `data/report-fixtures/`.
Machine reports are `tests/results/stage4.json` and `stage6.json`. Stage 4
acceptance remains conditional on Stage 3; Stage 6 on Stage 5. These module
checks do not establish real model decisions, browser submissions or Telegram
bot delivery. See `docs/STAGE_4_REPORT.md` and `docs/STAGE_6_REPORT.md`.

## Docker configuration

Create `.env` using the script above. Use URL-encoded values in DATABASE_URL.
For Compose set `OLLAMA_BASE_URL=http://host.docker.internal:11434` and use
`BIND_HOST=0.0.0.0` for the internal browser. Core gets its DB URL from Compose.

```powershell
docker compose up -d --build
```

The Docker path is prepared but has not been run on the current Windows host:
Docker and WSL are absent. Runtime tests here use real native PostgreSQL.

The six workflow exports live under `n8n/workflows/`. They use the credential
`JobHunter internal secret`, an HTTP Header Auth credential named
`x-jobhunter-token` whose value is CORE_SERVICE_TOKEN. Workflows are inactive
by default. Import/bootstrap must create this credential; never commit it.

## Candidate onboarding

Real candidate seed is in ignored `config/candidate_profile.yaml`; factual
project provenance is retained. The example is an empty template for verified
facts without legal name/contact details. Unknown onboarding values must remain
UNKNOWN. Discovery can run without contact information; CV generation requires
the real legal name; submission requires all fields demanded by the form.
Test-only fictional profiles must remain under `tests/fixtures/`.

## Verification and discovery

```powershell
node --env-file=.env --test --test-concurrency=1 tests/*.test.mjs
node --env-file=.env scripts/discovery-smoke.mjs
```

Smoke checks fetch public GET-only ATS endpoints with DNS/private-network and
redirect checks, bounded payloads/timeouts, and domain delays. This smoke scope
covers discovery/normalization only; it does not establish full production
readiness or perform applications. Results: `tests/results/real-discovery-smoke.json`.

## Configuration and data

`.env.example` lists submission, thresholds, schedule, retention, model and
service variables. The baseline is DRY_RUN=true, ALLOW_REAL_SUBMIT=false,
ALLOW_MOCK_SUBMIT=false. An empty real-domain allowlist permits no real submit.
Never publish browser control endpoints. Tokens/cookies/CVs/session dumps are
ignored. Application business state lives in PostgreSQL, not n8n history.

CVs: `data/cv/YYYY-MM/company/job_id/` (PDF, HTML, JSON and manifest).
Ledger: `data/exports/APPLICATIONS_LOG.md`, `applications_log.csv`.
Browser checkpoints: `data/browser/`; screenshots in configured artifact root.
Browser retention cleanup is implemented; encrypted backup automation remains implementation work. Preserve
the database, `.env` and ignored profile together when making an encrypted backup.

## Safety and recovery

Canonical statuses include SUBMITTING and SUBMISSION_UNKNOWN. Ambiguous submit
must never automatically retry. Human CAPTCHA replies do not transfer to new
challenges. Optional marketing consent remains unchecked; ambiguous legal
declarations require the user. Browser replay is limited to reversible actions
after reading current DOM; attempts are bounded by MAX_BROWSER_RECOVERY_ATTEMPTS.

