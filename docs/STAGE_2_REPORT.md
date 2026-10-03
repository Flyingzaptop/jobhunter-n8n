# Stage 2 — normalization and deduplication acceptance

Status: **PASS**, verified on 2026-10-03 after Stage 1 acceptance.

Command: `node --env-file=.env scripts/test-stage-2.mjs --skip-bootstrap`.
PowerShell entry point: `scripts/test-stage-2.ps1`.
Machine-readable evidence: `tests/results/stage2.json`.

The actual n8n CLI ran fixture discovery and then normalization twice against
dedicated PostgreSQL schema `stage12_c437c6d06f55407582ebab8aa100c721`.
Successful stored CLI execution IDs: discovery **7**, normalization **8**,
idempotency rerun **9**. Header-authenticated workflow HTTP nodes invoked the
same stage functions used by production. Unit tests are supplemental evidence.

Verified assertions:

- Seven persisted raw records become four canonical vacancies.
- Seven source links survive, including two sources sharing one job ID.
- Tracking parameters and equivalent Greenhouse host names collapse.
- Similar mechanical role titles at different companies remain separate.
- A second actual n8n normalization execution returns no new job IDs.
- PostgreSQL counts remain four canonical jobs and seven source links.
- No application rows are created or application actions invoked.

Normalization deterministically extracts employer, title, location, explicit
work mode, employment type, description, publication/expiry, explicit salary,
and source identities. Missing work mode is UNKNOWN. Expired records are CLOSED.
Descriptions are decoded and stripped of HTML/script/style content.
Mirrors do not erase known application URLs or work mode. Vacancy-identifying
query parameters survive removal of known tracking parameters.

Dedupe signals are canonical URL, scoped ATS ID, exact content fingerprint with
company/title/location identity, and conservative description similarity.
Distinct known ATS IDs, different companies, insufficient description data and
different mock/real profiles do not merge on similarity alone. Job IDs are
deterministic UUIDs; jobs/source-link writes are transactional in PostgreSQL.

Redirect resolution is available through the restricted fetch helper and is
explicitly opt-in; normalization of already structured ATS records performs no
additional network requests. Canonical extraction from JavaScript-only pages
without structured data and semantic LLM fallback are not established here.
This PASS does not imply full Stage 7 or real application readiness.
