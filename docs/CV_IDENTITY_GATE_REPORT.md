# Actual identity and PDF gate

Status: **PARTIAL**. The user's real legal name and contact fields were saved only
in ignored local profile/artifacts. Identity QA now passes. No personal contact
values are included in tracked documentation or test source.

One factual **document demo** passed real PDF text, contact, one-page rendering and
visual inspection. It is deliberately **not employer-ready**: the actual Canonical
application form requires the applicant's own words and rejects AI-generated
content. Application eligibility is false until the candidate supplies compliant
content. This demo contributes **zero** to the target of three employer-ready CVs.

| Actual context | Artifact ID | Document QA | Application eligibility |
|---|---|---|---|
| Canonical Python / hardware certification, actual REVIEW context | `790d2883-c9f6-46db-bcb4-2dd30efea33d` | PASS, 1 page | false; employer own-words policy |

The existing independent factual verdicts were reused only after exact unchanged
authoritative-fact reconciliation and current deterministic guards. Actual identity
was added separately, the posting was reverified OPEN, and no new inference or
candidate career fact was manufactured. The resulting PDF was rasterized with both
the native PDF renderer and Poppler; every page was inspected for legibility,
overlap, clipping, section order, visible provenance and degree-in-progress status.
The artifact is in approved `cv_versions` and `cv_drafts`, under the configured
`data/cv-v2` root; the policy block remains in its manifest.

An earlier fresh writer attempt with actual identity failed closed because a skill
label cited an unrelated source ID. The production writer grammar now binds each
exact skill label to only source IDs that explicitly establish that skill.
The bounded two-attempt gateway and independent entailment checks remain intact.
**16/16 CV regression tests pass**, including the new exact-label/citation test.

## New actual technical target screening

Five actual junior/student/technical postings were reverified through official ATS
GETs and analyzed sequentially by local Qwen, with real observed stage-3 records:

| Employer / actual role | Recorded raw fit | Decision | Gate disposition |
|---|---:|---|---|
| Bosch — Praktikum Sondermaschinenbau / Mechatronik / Konstruktion, Germany | null | REVIEW | 0 extracted requirements; incomplete |
| Ubisoft — Local IT Support, Lyon | 24.11 | REJECT | excluded |
| RIVR — Robotics Wireless & Network Engineer Intern, Zurich | 46.30 | REJECT | excluded |
| Stripe — Software Engineer Intern, Dublin | 72.79 | REJECT | excluded |
| Databricks — Software Engineering Intern, Berlin | null | REVIEW | 1 extracted requirement; incomplete |

These model decisions are retained in `tests/results/cv-gate-fit.json` and the DB.
No rejected result was relabeled, no unknown requirement was cleared, and no
incomplete REVIEW was counted as a suitable CV acceptance pass. Accounting clerks
and the historical US-only data-manager sample were excluded from this technical
gate. Further broad real-market analysis is needed to identify three actual
non-rejected, adequately analyzed roles for operator suitability review.

Current employer-ready CVs for this gate: **0 / 3**. Actual PDF demonstration: **1**.
Real employer submissions: **0**. GPU ownership was released after the five-job
screening; no duplicate inference process remains active.

## Reusable commands

```powershell
node --env-file=.env scripts/cv-gate-fit-candidates.mjs <actual-job-UUIDs>
node --env-file=.env scripts/cv-v2-identity-gate.mjs <actual-REVIEW-or-STRETCH-job-UUIDs>
```

After every rendered page has actually been inspected:

```powershell
node --env-file=.env scripts/cv-approve-visual.mjs <actual-cv-UUIDs> --rendered-pages-inspected
```

The approval command rechecks profile hash, factual and identity QA, PDF hash and
page evidence before recording visual review and adding approved artifacts. It
does not bypass an employer content-policy block or perform an application.
