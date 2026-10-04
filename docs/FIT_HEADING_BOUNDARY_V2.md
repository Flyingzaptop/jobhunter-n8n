# Fit v2.7: real vacancy qualification boundaries

The real Waymo simulation internship and ALTEN CAD vacancy returned valid but
empty fit requirement arrays under v2.6. Their employer descriptions were
present and complete; this was not proof that the employers provided no
requirements.

The boundary investigation compared persisted original source records with
normalization, PostgreSQL descriptions, CV smoke input lengths and the exact
source-fragment catalog:

- Waymo `b083e564-e351-570a-b11c-5ab752d7f190`: original Greenhouse content
  4,049 characters →normalized 3,282 characters; exactly identical to PostgreSQL
  and the real fit sample. The 36-fragment v2.6 catalog had zero explicit hints
  because `You have:` and `We prefer:` were unrecognized.
- ALTEN `a4c6c2d6-9b18-5bab-baf7-424b936caf43`: hydrated official
  SmartRecruiters content 3,340 characters →normalized 2,304 characters;
  identical to PostgreSQL and the real sample. `Qualifications`, `Formation /
  Expérience`, `Compétences techniques` and `Qualités personnelles` were
  unrecognized, so the 43-fragment v2.6 catalog had no explicit hints.
- Canonical `4a56d8a3-ba42-5d77-9999-b9cb0df08b85`: the literal heading
  `Required skills and experience` was incorrectly split into mandatory
  `Required skills` and `experience` fragments. It did not scope the body
  correctly; `Desired skills and experience` was also unrecognized.

v2.7 recognizes bounded standalone section names, inherits their mandatory or
preferred importance for the following actual clauses and ends scope at
responsibilities, benefits or company-description sections. Heading strings
themselves are context-only. Arbitrary prose containing these words does not
start a section. Employer capability and work-format fragments remain excluded
from scored qualifications. French `ou`/`soit` alternatives and examples remain
one exact qualification, preserving the existing English `or` safeguards.

The prompt/version is now `fit-analysis-v2.7-compact`. No candidate facts,
requirement matches, scores or routing outcomes were injected to repair the
catalog. The underlying descriptions and exact quotations were not rewritten.

Regression verification: 7 observed-heading tests plus all 45 existing Stage 3
tests pass (52/52); with discovery/freshness regressions the targeted suite is
62/62. A trailing `Note:` ends inherited preference scope for application
instructions; an explicit legal qualification inside a note remains mandatory.
These are deterministic regression checks, **not** real local-model
acceptance. Fresh model analyses must be run separately under v2.7 before any
new candidate suitability or CV readiness conclusion.

Ignored evidence: `tests/results/market-fit-boundary-investigation.json` records
the original data boundary; `tests/results/fit-heading-boundary-v2.7.json` records
the corrected catalogs from those actual stored vacancies without model calls.

Freshness also remains separate: a published employer feed can establish current
publication at discovery time; before CV/application, `reverifyMarketJob` performs
a new official posting GET (or complete Ashby board snapshot). Aggregator-only
posts, protected access responses, malformed replies and wrong posting IDs return
UNKNOWN. Inactive, explicitly closed, expired or deleted official postings are
CLOSED. A reachable page or stale OPEN flag alone cannot authorize processing.

## v2.8 German extension

The actual Bosch mechatronics internship
`8991663a-bb95-5105-b8fd-933fc49088c1` has a complete hydrated German description,
but v2.7 did not recognize its `Qualifikationen` heading. v2.8 adds bounded German
section/profile names and exact inline `Ausbildung`, `Erfahrungen und Know-how`,
`Persönlichkeit und Arbeitsweise`, `Begeisterung`, `Sprachen`, and `Arbeitsalltag`
labels. `Zusätzliche Informationen` ends scope; explicitly required enrollment
clauses remain requirements. `oder` alternatives/examples stay one clause.

Two regression cases grounded in that observed vocabulary pass alongside all
previous tests: 54/54 fit regressions. German language capability and completed
degree truth are not assumed. Fresh actual Qwen reanalysis is separate evidence.

## v2.9 ongoing education correction

Assistant manual reference review exposed that the actual Waymo requirement
`Currently pursuing a Bachelor's or Master's degree ... or a related technical
field` was incorrectly treated by the deterministic education guard as requiring
graduation. v2.9 applies the completion guard only to completed-degree demands.
Ongoing/pursuing/enrolled/studying and multilingual study-status clauses retain
their model-supported match and uncertainty. Related-field PARTIAL remains
PARTIAL; missing level/enrollment evidence remains UNKNOWN. No BSc or graduation
fact is introduced. Bare completed degree/BSc, French diplômé and German
abgeschlossen requirements still cannot be satisfied by an incomplete degree.

The trailing real Waymo multi-application direction is now explicitly context-only
and excluded from score mapping. Three new regression cases plus all prior fit
checks pass 57/57. The live queue was paused at a current-job boundary and then
resumed with new prompt hashes; prior outputs remain audit evidence.
