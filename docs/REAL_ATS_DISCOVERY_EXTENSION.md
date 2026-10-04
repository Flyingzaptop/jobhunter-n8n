# Bounded real ATS discovery extension

Run `7fbd3dcd-77b4-43ae-9b29-0a4ae1398aa6`, 2026-10-04. Scope: two actual
employer career sites, ordinary public GET only. Overall **PARTIAL**. No GPU,
fit inference, browser filling or employer submissions were performed here.

## Teamtailor

The [official Teamtailor career index](https://career.teamtailor.com/jobs) and
[its robots policy](https://career.teamtailor.com/robots.txt) returned HTTP 200.
The policy permits public job pages while excluding internal/application-message
paths. Three observed index links were fetched; each returned one exact public
JobPosting with employer name, title and full description. PostgreSQL retained
the raw structured source, normalized vacancy, source mapping and discovery run.

| Actual posting | Canonical job ID |
|---|---|
| [Director — Data & Analytics](https://career.teamtailor.com/jobs/8124466-director-data-analytics) | `833d43f6-5e69-5b62-92be-bf97c5e48379` |
| [Customer Support Agent — Dutch/English](https://career.teamtailor.com/jobs/7951948-customer-support-agent-dutch-english-speaking) | `de472a03-c260-5d3e-81e2-b65255bcfe1e` |
| [AI Accelerator](https://career.teamtailor.com/jobs/7748148-ai-accelerator) | `6102989c-2e09-57fb-8fd9-2ce9e122a62a` |

Source `teamtailor-teamtailor-public`: OPERATIONAL, 3 raw →3 unique, 3 new.
These are actual publication records, not a candidate suitability claim. A
director role or a Dutch-language requirement may be unsuitable; fit analysis
has not been run by this extension. This bounded sample is not the entire
Teamtailor employer market or an exhaustive scan of this employer.

Fresh `reverifyMarketJob` for this source checks the ordinary robots response,
current index membership and exact official JobPosting detail again. Matching
origin/path, real employer/title and nonempty description are required. An
expired posting becomes CLOSED; missing index membership or conflicting
structured identity remains UNKNOWN. GET access to one page alone is insufficient.

## NVIDIA Workday

The supplied [actual NVIDIA Workday posting URL](https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Software-Engineer--CUDA-Deep-Learning-Systems_JR2022831)
was retained as a bounded source target. Ordinary public GET of
[robots.txt](https://nvidia.wd5.myworkdayjobs.com/robots.txt) returned HTTP 200
**HTML application shell**, not a usable robots policy. An initial ordinary
vacancy GET also returned a JavaScript shell with no JobPosting structured data.
No job details were imported and no OPEN/suitability claim was made.

Source `workday-nvidia-public`: MANUAL_DISCOVERY_FALLBACK,
`INVALID_ROBOTS_PAYLOAD`, 0 discovered vacancies. The operational adapter now
fails closed before fetching details when the robots response is HTML/unusable.
No protected/CXS API, authentication, cookies, stealth browser or access-control
bypass was attempted. A separate approved/manual browser compatibility attempt
may report its own limitations; this discovery run is not evidence of a filled
Workday application form.

## Evidence and regression scope

Ignored live evidence:

- `tests/results/market-ats-extension-access.json` — ordinary public access/robots results;
- `tests/results/market-teamtailor-details.json` — exact fetched real JobPosting data;
- `tests/results/market-ats-extension.json` — persisted source/run/canonical counts;
- `data/runtime/market-ats-extension.out.log` — actual per-source observer events.

The catalog now has 155 source/capability entries: the previous 153 plus these two
bounded targets. The accepted 13,737 →13,707 broad discovery report is unchanged;
new samples are not silently added to that run's counts. Mandatory Polish and
LinkedIn coverage remains PARTIAL.

Three new regression tests verify exact public-listing/detail matching,
expired postings, denied or unusable robots and mismatched identities. They are
deterministic regression evidence, separate from the live results above.

Real employer submissions in this extension: **0**.
