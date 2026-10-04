# CV Factory v2

`buildTailoredCv({job,profile,analysis,llm,repository?,outputRoot?})` in
`services/core/cv-v2.mjs` creates a tailored content draft and an artifact manifest.
The caller must reverify the real posting OPEN before calling it. No employer
submission occurs here. Existing v1 compatibility is managed by the core caller.

The strong Ollama writer uses `LLM_STRONG_MODEL`; the separate fast Ollama verifier
uses `LLM_FAST_MODEL` by default. Explicit `CV_WRITER_MODEL` and `CV_VERIFIER_MODEL`
override those roles only for CV generation, preserving the global fit model and
explicit injected regression gateways. This workstation sets both scoped models
to the installed `gemma4:e2b-it-qat` after a real-world comparison. Both are real
local Ollama calls in production. Fact IDs
constrain the writer grammar. Each generated claim is checked against only its
cited facts. A separate verifier judges entailment, followed by fail-closed
deterministic checks for technology labels, numbers, seniority, employers,
professional years, degree status and section provenance. Skills retain supplied
qualifiers and use exact allowed labels. Employer titles are relevance context;
the candidate headline is fact-grounded. LLM verification remains fallible, so
claims do not bypass the deterministic checks or identity/PDF gates.

The manifest exposes separate `qa.claims`, `qa.identity` and `qa.pdf`. An unknown
real name, email or phone produces `BLOCKED_IDENTITY`, with JSON/HTML and fact map
retained; no submission-ready PDF is created and overall `qa.pass` remains false.
Fixture identities are rejected for real CV generation. Failed entailment produces
`BLOCKED_CLAIMS`. PDF failure produces `BLOCKED_PDF`. Full `PASS` requires known
identity, contacts, factual checks, parseable 1–2 page PDF and browser visual sanity.
The saved preview enables human visual review. Deterministic visual checks establish
visibility/overflow only; they do not substitute for a human inspecting the preview.

Artifacts: `cv.json`, `cv.html`, `source-fact-map.json`, `manifest.json`; additionally
`cv.pdf` and rasterized `cv.page-N.png` only when identity and factual checks pass. Manifest
paths are for the authenticated backend, never arbitrary client file access.
Optional `repository.recordCvDraft(manifest)` persists blocked and successful
drafts; core integration owns its database implementation.

Application text is generated only for explicitly required cover letter/motivation
or `analysis.application_text_requested`. It shares claim checks and provenance.

Profile clarification pending: Were any React/Django/internal web tools actually
created as part of professional hospital employment? React/Django facts remain
PERSONAL_PROJECT until the candidate supplies verified professional evidence.

Regression tests may inject a structured gateway. Such tests are labelled
MOCK / REGRESSION and establish guard behavior only. Real-world acceptance requires
actual open employer jobs, the real candidate fact store and real Ollama writing
and entailment calls; missing identity must be reported honestly as blocked.

Real-world harness: `node --env-file=.env scripts/cv-v2-real-smoke.mjs`.
It selects actual discovered European/Polish junior and student target listings,
reverifies official ATS publication, hydrates selected summary-only details, runs
real fact-based fit and skips rejected listings. Results checkpoint to
`tests/results/cv-v2-real.json`; generated drafts also persist to `cv_drafts`.
No result from the regression gateway contributes to these acceptance metrics.

Actual-identity follow-up is documented in `docs/CV_IDENTITY_GATE_REPORT.md`.
The exact skill grammar binds every allowed label to only its supporting fact IDs.
`scripts/cv-v2-identity-gate.mjs` generates actual REVIEW/STRETCH CVs into the
configured `data/cv-v2` root. `scripts/cv-approve-visual.mjs` records completed
rendered-page inspection and registers approved artifacts. Employer content-policy
blocks remain separate from factual/PDF QA and prevent application eligibility.
