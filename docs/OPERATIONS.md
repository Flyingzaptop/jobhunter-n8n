# Running the local stack

From the project root on Windows:

```powershell
.\scripts\start-local.ps1
node --env-file=.env scripts/n8n-bootstrap.mjs
node --env-file=.env scripts/healthcheck.mjs
```

Ollama must be running with `qwen3.5:4b` installed. The startup script launches
PostgreSQL, core, browser and n8n as hidden background helpers, reusing listening
ports. Logs and process IDs are in ignored `data/runtime/`. The editor listens on
http://127.0.0.1:5678. PostgreSQL is localhost55432; core3000; browser3001.

Import leaves all production workflows unpublished. n8n2.x sub-workflow calls
require published child versions. Publish in reverse dependency order only after
reviewing configuration, then restart n8n to activate schedules. The isolated
queue test publishes only its own copies and unpublishes them on completion:

```powershell
node --env-file=.env scripts/test-queue-handoff.mjs
```

Discovery runs hourly when activated; persisted queues have fifteen-minute
backlog triggers. Application filling additionally requires
`APPLICATION_FILL_ENABLED=true`; final real submit still requires DRY_RUN=false,
ALLOW_REAL_SUBMIT=true and an explicit domain allowlist. None are enabled by this
delivery. Stage7 uses a separate exact-local-mock exception.

## Candidate and Telegram setup

Fresh installation creates the real seed from the committed master document:

```powershell
node scripts/init-profile.mjs
node scripts/onboarding.mjs
```

The seed command refuses to overwrite an existing profile. Fill known values in
ignored `config/candidate_profile.yaml`; leave unknown facts UNKNOWN. Legal name
is required for real CV QA. Email, phone, start date and other answers are required
only when a form needs them. Never use a fictional fixture as the real profile.

Set TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_CHAT_ID in ignored `.env`, then:

```powershell
node --env-file=.env scripts/telegram-poll.mjs
```

Supported controls: /status, /summary, /weekly, /pause, /resume and
`/outcome APPLICATION_UUID STATUS`. Monday's daily report includes a weekly funnel
when WEEKLY_FUNNEL_ENABLED=true. Only the allowed chat can act. The poller cursor
is currently process-local; stored question correlation rejects repeated replies.
For publication/configuration changes restart the relevant local service.

## Validation and artifacts

```powershell
node --env-file=.env --test --test-concurrency=1 tests/*.test.mjs
.\scripts\test-stage-7.ps1 -SkipBootstrap
node --env-file=.env scripts/real-readiness-smoke.mjs
```

Stage scripts have Node, PowerShell and shell wrappers. Stage7 creates a new
isolated database schema and artifact directory each run. The production database
is retained. Latest machine evidence is in ignored `tests/results/`; readable
acceptance reports are committed under `docs/`.

CVs: `data/cv/YYYY-MM/company/job_id/`; ledger: `data/exports/APPLICATIONS_LOG.md`
and `applications_log.csv`; weekly breakdowns: `weekly_conversion.json`.
Stage7 artifacts are under `data/test-stage7/SCHEMA/` and never committed.

## Backup and limitations

Back up PostgreSQL using pg_dump and preserve `.env`, the private profile, answer
memory and artifact folders in encrypted storage. Native local cluster files live
in `data/local-postgres/`; copy the cluster only after PostgreSQL is stopped.
Protect the n8n encryption key so its credentials remain recoverable. Restore to
an isolated instance and run migrations/healthchecks before enabling workflows.

Docker Compose is prepared but unverified on this host: Docker/WSL are absent.
Actual acceptance used native PostgreSQL, n8n CLI, Ollama and Chromium. Real
Telegram delivery is not verified because no bot credentials are supplied.
Browser boundary limitations are documented separately: unapproved real POST
actions, unfamiliar document requirements and authentication need manual takeover.
CV generation currently selects and renders exact factual statements; full Polish
prose translation, motivation/cover-letter generation and broader ATS compatibility
are further implementation work. The project is not yet declared complete under
the full master definition of done.
