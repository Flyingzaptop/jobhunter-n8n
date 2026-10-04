# CV Factory v2 real-world evidence

Status: **PARTIAL**. Factual content QA passed for four actual vacancy contexts;
submission-ready CV/PDF acceptance remains blocked by the real candidate identity.
Real employer submissions: **0**. No fixture identity was substituted.

Evidence window: 2026-10-04 06:30:38–07:10:11 UTC. Detailed checkpoint evidence:
`tests/results/cv-v2-real.json`; artifacts and manifests are retained under
`data/cv-v2-real` and `data/cv-v2-real-diagnostics`, and in PostgreSQL `cv_drafts`.

## MOCK / REGRESSION TESTS

15 CV regression tests pass. They cover unknown/fixture identity, source IDs,
independent uncertainty, missing/duplicated verdict IDs, unsupported technologies,
numbers, employers, degree levels, years and seniority, professional/project scope,
YAML skill qualifiers, rejected diagnostic isolation, scoped model configuration,
and preservation of authoritative facts when hiding an undocumented RL policy
clause from the writer's candidate-facing input. Injected gateways in these tests
do not contribute to real-world acceptance.

The installed PDF renderer was also checked read-only against an existing
regression PDF: one actual rasterized page, 1100 pixels wide, 72,186 PNG bytes.
This establishes a renderer capability, not real-candidate PDF acceptance.

## REAL-WORLD TESTS

The real profile `config/candidate_profile.yaml` was used unchanged. Nine distinct
actual vacancies were examined through 12 real Ollama fit calls, including three
re-analyses after qualification-heading parsing was corrected. Official ATS
publication was reverified through permitted public GETs. Selected SmartRecruiters
summary listings were hydrated from their actual employer detail before analysis.
No fit score, candidate fact or routing decision was injected.

Latest recorded decisions within this CV evidence run:

| Employer and actual role | Raw fit | Decision | Fit prompt |
|---|---:|---|---|
| RIVR — Mechanical Engineer (Junior) | 45.68 | REJECT | v2.6 |
| Bosch — Working Student in Verification & Validation & Test Automation | 30.30 | REJECT | v2.6 |
| Bosch — Junior Data Scientist for (e-)Mobility Cloud Solutions | 0 | REJECT | v2.6 |
| Waymo — Software Engineer intern, Release Evaluation (Simulation), Warsaw | 64.71 | REJECT | v2.7 |
| ALTEN — Ingénieur Concepteur en CAO Tuyauterie Junior | 8.82 | REJECT | v2.7 |
| Planet — Working Student, Professional Services | 12.50 | REJECT | v2.6 |
| RIVR — Junior Electronics Engineer | 34.44 | REJECT | v2.6 |
| Canonical — Python Software Engineer, Ubuntu Hardware Certification | 100 | REVIEW | v2.7 |
| Datadog — IT Support Technician Intern, Paris | 85.21 | REJECT | v2.6 |

These are recorded model/routing results, not a claim that the fit engine has
perfectly calibrated all requirements. Canonical's raw 100 still carries unknown
employment-route conditions; it must not be presented as verified professional
Python/agile/Linux expertise. The Waymo v2.7 sample preceded the final boundary
correction that excludes two application instructions from preferred requirements;
its recorded decision is historical evidence, not a final acceptance benchmark.

### Actual CV writing and independent verification

The completed local `gemma4:e2b-it-qat` run used the real writer and a separate
entailment verifier call, with verification split into bounded six-claim evidence
bundles. Deterministic guards ran in addition to model entailment. Every generated
claim retains source fact IDs; degree-in-progress and project provenance remain
visible. Unknown name/email/phone were kept absent from candidate-facing drafts.

| Scope | CV ID | Claims checked | Factual QA | Overall status |
|---|---|---:|---|---|
| Canonical Python, actual REVIEW context | `158d0b6b-4492-49bc-af2c-663bf3f70505` | 15 | PASS | BLOCKED_IDENTITY |
| RIVR mechanical, rejected diagnostic only | `7c419dba-ca1c-41ea-87ac-45bc46a50972` | 13 | PASS | REJECTED_DIAGNOSTIC_CONTENT |
| Bosch test automation, rejected diagnostic only | `85e858df-eca3-4798-b420-90b69ba11a85` | 16 | PASS | REJECTED_DIAGNOSTIC_CONTENT |
| Bosch data science, rejected diagnostic only | `49877622-3bd5-49e1-8db1-ae203fe2f52c` | 16 | PASS | REJECTED_DIAGNOSTIC_CONTENT |

The three rejected diagnostics have `application_eligible=false`, their original
`source_decision=REJECT`, and separate `content_status=BLOCKED_IDENTITY`. They prove
writer grounding and differentiation across actual target contexts only. They
count as **zero suitable-CV acceptance**, create no approved CV version and cannot
enter the employer application queue. Mechanical content prioritizes CAD,
prototyping and embedded/simulation work; data content prioritizes Python and
time-series experimentation. Different headline, summary, ranked skills and
project selections are preserved in the actual JSON/HTML artifacts.

Totals: non-rejected content factual QA passes **1**; rejected diagnostic content
factual QA passes **3**; full real-candidate PDF passes **0**; real submissions **0**.
All 60 generated claims in the final four-context run received SUPPORTED verdicts.
This is an observed QA result, not a guarantee that a model verifier is infallible.

Earlier `qwen3.5:4b` attempts remain blocked and archived in the evidence JSON/DB.
They exposed genuine paraphrase/provenance problems, incorrect degree additions,
and false-positive guard/verifier behavior. Fixes preserve the authoritative fact
store and do not override any failed verdict into PASS. This operational comparison
was conducted while code/prompts were refined; it is not a controlled benchmark
proving general superiority of one model.

### Observation and configuration

The final calls were wrapped in real stage-4 `operation_runs`. Genuine writer and
verifier start/completion events were emitted while inference occurred. Manifests
retain operation IDs and model request statistics; no retrospective RUNNING
events, hidden reasoning or raw prompts were fabricated.

Global extraction/fit stays `qwen3.5:4b`. Ignored local `.env` now sets only scoped
`CV_WRITER_MODEL=gemma4:e2b-it-qat` and
`CV_VERIFIER_MODEL=gemma4:e2b-it-qat`; `.env.example` documents optional blank
inheritance. A configuration regression and an actual `--env-file=.env` client
inspection confirm that the global fit client remains unchanged. Existing core
processes need restart to read the new environment. No new model was downloaded;
the compared Gemma model was already installed. GPU ownership was released after
the completed run.

Reproduce fit/content smoke:

```powershell
node --env-file=.env scripts/cv-v2-real-smoke.mjs
node --env-file=.env scripts/cv-v2-diagnostic-real.mjs --skip-it --cv-model=gemma4:e2b-it-qat
node --test tests/cv-v2.test.mjs
```

The diagnostic command intentionally uses previously persisted genuine rejected
analyses; it never changes a REJECT to obtain a CV acceptance pass.

## Remaining CV blockers and limits

- Real legal name, email and phone remain UNKNOWN. No real PDF was generated,
  uploaded or visually accepted; 1–2 page real-candidate PDF QA remains unproven.
- Only one non-rejected context produced factually checked content. Three suitable
  real roles with full CV/PDF acceptance have not been established.
- Final real content was English. Polish template/provenance labels have regression
  coverage; real Polish writer/translation acceptance was not part of this run.
- Model entailment remains fallible and must stay paired with deterministic guards
  and visible provenance. Changed jobs/profile/models require fresh checks.
- The final actual artifacts predate the small writer-input cleanup that omits the
  original conditional reinforcement-learning policy sentence. Authoritative facts
  stay unchanged; some retained drafts still show that explicit condition rather
  than claim undocumented RL experience. This cleanup has regression coverage and
  must receive fresh inference QA on the next generation.
- Profile clarification remains unanswered: were any React/Django/internal tools
  actually created during professional hospital employment? React/Django facts
  remain PERSONAL_PROJECT; no professional relabeling was performed.
