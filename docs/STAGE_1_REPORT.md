# Stage 1 — discovery acceptance

Status: **PASS**, verified on 2026-10-03.

Command: `node --env-file=.env scripts/test-stage-1.mjs --skip-bootstrap`.
PowerShell entry point: `scripts/test-stage-1.ps1`.
Machine-readable evidence: `tests/results/stage1.json`.

The actual n8n CLI executed imported workflow `WF01Fixture`, using the Stage 1
HTTP action and its stored header credential. PostgreSQL
`n8n.execution_entity` records successful CLI execution **6**. The test core was
explicitly constructed in fixture mode and used the dedicated schema
`stage12_1a1d27677ee94f179d9242bb21e6ce30`.

Verified assertions:

- Seven raw discoveries are persisted in PostgreSQL.
- Three source formats are represented: Greenhouse JSON, Lever JSON, RSS 2.0.
- Mechanical engineering, robotics research and Python development are present.
- Every raw source metadata field and original payload equals its fixture input.
- The fixture includes tracking-URL mirrors of the same vacancy.
- No application rows are created; no submission action is invoked.

The acceptance fixture route is blocked outside explicit test mode. Production
workflow exports remain inactive. Nine native Stage 1/2 unit tests also pass.

Production adapters implemented: Greenhouse, Lever, Ashby, RSS 2.0, official
pages with JobPosting JSON-LD, manual seeds and the isolated mock JSON source.
Fetching is GET-only, host-allowlisted, bounded by timeout/body size, serially
rate-limited per host, and checked for private DNS addresses at redirects and
the actual socket connection.

Separate real-source smoke evidence currently records 407 discoveries:
Canonical/Greenhouse 310, RIVR/Lever 35, Ashby 62. These were persisted and
normalized in PostgreSQL. See `tests/results/real-discovery-smoke.json`.
This proves the configured feeds, not comprehensive geographic or role coverage.
The full Stage 7 and subsequent production-readiness gate are still separate.

Official adapter references:

- https://docs.greenhouse.io/job-board.html
- https://github.com/lever/postings-api
- https://developers.ashbyhq.com/docs/public-job-posting-api

Limitations: HTML extraction requires structured JobPosting JSON-LD; RSS support
currently targets RSS 2.0 rather than Atom. Email/search-provider adapters are
extension points, not implemented production adapters. No LLM, CV, browser
application flow or Telegram interaction is established by this stage.
