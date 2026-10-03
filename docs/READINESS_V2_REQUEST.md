# JOBHUNTER — NEXT MAJOR RUN
## Real-World Readiness + Full-Control / Observation Admin Dashboard

Repository:

https://github.com/Flyingzaptop/jobhunter-n8n

Current accepted baseline commit:

`64ab595fb6722da9dd2cb21a2e44368c8d67f37c`

You are continuing an existing system. Do not rebuild it from scratch.

The current architecture is accepted:

- n8n = orchestration;
- PostgreSQL = persistent state and audit log;
- Core service = deterministic business logic;
- Ollama = bounded structured reasoning;
- Browser service = guarded browser execution;
- Telegram = HITL;
- candidate fact store = factual source of truth;
- state machine = authoritative application lifecycle.

The current implementation successfully passed Stages 1–7 and 80/80 tests.

However, overall production status is correctly still `PARTIAL`.

Your task in this run is to move JobHunter from a safe laboratory MVP toward a useful real-world job-search system while preserving all existing safety and factual guarantees.

---

# 0. NON-NEGOTIABLE RULES

Do not weaken existing safeguards in order to make tests pass.

In particular:

- never invent candidate facts;
- never convert academic/personal/independent R&D into professional employment;
- never invent professional years;
- never silently answer unknown legal/salary/consent questions;
- never automatically retry an ambiguous Submit;
- `SUBMISSION_UNKNOWN` must remain fail-safe;
- no CAPTCHA bypassing;
- no automatic authentication/password/2FA handling;
- no secret leakage into prompts/logs/dashboard;
- no arbitrary code execution from vacancy content;
- vacancy text remains untrusted data;
- no uncontrolled POST requests from browser automation;
- real submissions must remain DISABLED for this entire run.

### Important

For this whole run:

```env
DRY_RUN=true
ALLOW_REAL_SUBMIT=false
```

The system may reach a final application review page on a real employer website, but it must never perform the final Submit.

Do not change this requirement.

---

# 1. PRIMARY GOALS

This run has four major goals:

1. **Discovery v2 — dramatically expand real job coverage.**
2. **CV Factory v2 — generate genuinely vacancy-tailored CVs.**
3. **Real ATS compatibility testing — measure browser ability on real application forms without submitting.**
4. **Build a full-control web admin dashboard for observing and controlling JobHunter.**

The admin dashboard is a first-class requirement, not a side task.

---

# 2. ADMIN DASHBOARD — JOBHUNTER CONTROL CENTER

Build a simple but high-quality browser-based web application that becomes the primary control and observation interface for JobHunter.

The goal is:

> At any moment I should be able to open one page and understand exactly what JobHunter is doing, what it has done, what is waiting, what failed, what the AI decided, what the browser currently sees, and why the system made every decision.

Think of it as:

**n8n + task manager + browser observer + AI trace viewer + analytics dashboard + application ledger**

in one interface.

Do not create a fake visual demo.

The dashboard must read the actual JobHunter PostgreSQL/core/browser state.

Preferred stack:

- React
- TypeScript
- Vite or another simple modern frontend stack

A lightweight backend endpoint may be added to Core or a dedicated dashboard backend may be created if justified.

Avoid unnecessary framework complexity.

---

# 3. DASHBOARD — MAIN OVERVIEW

The landing page should show a real-time system overview.

At minimum:

### System status

Show:

- JobHunter running / paused;
- dry-run status;
- real-submit status;
- PostgreSQL health;
- Core health;
- Browser service health;
- Ollama health;
- n8n health;
- Telegram configuration/health;
- current model;
- current profile version;
- current search policy version;
- last successful discovery;
- last successful analysis;
- last generated CV;
- last application activity.

Clearly display:

```text
DRY RUN
REAL SUBMIT DISABLED
```

when applicable.

It must be impossible to visually confuse test/dry-run mode with production submission mode.

---

# 4. LIVE PIPELINE VISUALIZATION

Build a visual pipeline representation.

For example:

```text
DISCOVERY
   ↓
NORMALIZE / DEDUPE
   ↓
FIT ANALYSIS
   ↓
CV FACTORY
   ↓
APPLICATION / HITL
   ↓
REPORTING
```

This should not be a static diagram.

Each stage must visually display its actual state:

- idle;
- queued;
- running;
- waiting;
- needs user;
- failed;
- completed;
- paused.

The currently active stage should be visually highlighted.

For each stage show at least:

- current run ID;
- started time;
- elapsed time;
- processed count;
- remaining count where known;
- success count;
- failure count;
- current item/job/application;
- latest event.

Clicking a stage should open a detailed view.

---

# 5. STAGE INSPECTOR

I want to be able to click any pipeline block and inspect what it is doing.

Examples:

## Discovery inspector

Show:

- active sources;
- source URL / adapter;
- last request time;
- discovered count;
- errors;
- rate-limit state;
- jobs returned;
- raw → canonical statistics.

## Normalize inspector

Show:

- raw vacancy;
- normalized vacancy;
- canonical URL;
- duplicate detection result;
- duplicate confidence;
- duplicate signal;
- source mappings.

## Fit-analysis inspector

Show:

- vacancy title/company;
- model used;
- prompt version;
- overall fit;
- category scores;
- decision;
- work-format classification;
- hiring feasibility;
- hard blockers;
- reasons;
- requirements table.

For each requirement show:

```text
Employer requirement
Importance
Candidate match
YES / PARTIAL / NO / UNKNOWN
Candidate fact IDs used
Fact provenance
Reason
```

Allow clicking the candidate fact ID to see the exact candidate source fact.

Do NOT expose hidden chain-of-thought.

Show only the structured model output, verified facts, deterministic calculations, validation information and system events.

---

# 6. LIVE BROWSER OBSERVER

This is very important.

When JobHunter is currently interacting with a browser/application form, the dashboard should provide a live visual observer.

I want something resembling a small embedded browser window.

It does NOT need to provide arbitrary remote browser control.

Prefer safe observation.

For example:

- periodic screenshots or screenshot stream;
- current URL;
- page title;
- current form step;
- detected fields;
- fields already filled;
- fields awaiting answers;
- uploaded CV;
- current browser session ID;
- CAPTCHA detected;
- validation errors;
- navigation/action history;
- blocked requests;
- submit state.

Refresh screenshots reasonably quickly while a session is active.

For example every 1–2 seconds when actively viewed.

Do not permanently record screenshots at high frequency.

Respect the existing PII retention model.

If technically reasonable, use an event-driven/SSE mechanism rather than constant aggressive polling.

Do not expose Playwright's debugging interface publicly.

Do not create an insecure browser remote-control endpoint.

---

# 7. CURRENT ACTION VIEW

Next to the browser observer, show a human-readable description of what JobHunter is currently doing.

Examples:

```text
Reading vacancy requirements
```

```text
Matching mandatory CAD requirement against candidate facts
```

```text
Generating vacancy-specific CV
```

```text
Opening employer application form
```

```text
Filling email field from candidate profile
```

```text
Waiting for user response: earliest start date
```

```text
CAPTCHA detected — waiting for user
```

```text
Final review reached — Submit blocked because DRY_RUN=true
```

This information must come from actual application/event state, not random frontend animations.

---

# 8. JOB / VACANCY EXPLORER

Create a proper jobs page.

Table/list columns should include at least:

- company;
- role;
- source;
- published date;
- first seen;
- location;
- work format;
- remote region;
- can work from Poland;
- employment route;
- fit;
- technical fit;
- professional experience fit;
- education fit;
- language fit;
- decision;
- application priority;
- current status.

Filters:

- role family;
- source;
- fit range;
- decision;
- company;
- country;
- work format;
- remote / hybrid / onsite;
- auto-apply eligible;
- published/seen date;
- analyzed/not analyzed;
- CV generated;
- application status.

Search should work.

Clicking a vacancy opens a full vacancy detail page.

---

# 9. VACANCY DETAIL PAGE

Display:

### Vacancy
- original title;
- company;
- canonical URL;
- source(s);
- raw source metadata;
- description;
- published/verified timestamps.

### Analysis
Full structured fit result.

### Candidate evidence
All candidate facts used.

### Routing
Explain deterministically why it became:

- AUTO_APPLY;
- REVIEW;
- STRETCH;
- REJECT.

### CV
Show:

- generated CV version;
- PDF preview/download;
- fact provenance;
- CV QA result;
- template/prompt/model versions.

### Application
Show application state machine timeline if one exists.

---

# 10. APPLICATION TIMELINE

For every application create a timeline from append-only events.

Example:

```text
DISCOVERED
ANALYZED
AUTO_APPLY
CV_CREATED
QUEUED
OPENING
FILLING
NEEDS_USER
FILLING
CAPTCHA_WAIT
FILLING
READY_TO_SUBMIT
DRY_RUN_BLOCKED
```

Each event should show:

- timestamp;
- event type;
- relevant metadata;
- run ID;
- state transition;
- errors if applicable.

This page should make debugging an application possible without manually querying PostgreSQL.

---

# 11. HUMAN-IN-THE-LOOP CENTER

Create a dedicated view for everything currently requiring me.

Examples:

- missing onboarding field;
- salary question;
- relocation question;
- consent;
- CAPTCHA;
- unsupported form;
- authentication/manual takeover;
- unknown work eligibility;
- submission reconciliation.

Show:

- company;
- role;
- exact question/problem;
- screenshot where relevant;
- time waiting;
- application ID.

Do not bypass Telegram.

Dashboard can initially be observation-only for answers if that keeps the implementation safer.

If you implement answers from the dashboard, they MUST use the same persisted application question/correlation mechanism as Telegram.

There must never be two independent answer systems with inconsistent state.

---

# 12. GLOBAL CONTROLS

Add clearly separated safe controls.

At minimum:

### Pause JobHunter

Equivalent to current `/pause`.

### Resume JobHunter

Equivalent to current `/resume`.

### Run discovery now

Trigger WF-01 safely.

### Analyze queued jobs

Trigger Stage 3 safely.

### Generate queued CVs

Trigger Stage 4 safely.

### Process application queue

Only while application fill is enabled and existing safety checks permit it.

### Reporting refresh

Trigger Stage 6.

Do NOT provide a convenient "disable all safety and submit everything" button.

Real-submit enablement must not be introduced in this run.

---

# 13. OBSERVABILITY / EVENT SYSTEM

Currently much of the system can be reconstructed from database state, but the dashboard needs clearer live observability.

Implement a structured event/operation model if necessary.

Every meaningful operation should produce observable metadata such as:

```json
{
  "run_id": "...",
  "stage": 3,
  "entity_type": "job",
  "entity_id": "...",
  "operation": "FIT_ANALYSIS",
  "status": "RUNNING",
  "message": "Analyzing requirements",
  "started_at": "...",
  "completed_at": null
}
```

Do not store model hidden reasoning.

Do store:

- structured request metadata;
- model name;
- prompt version;
- response validation state;
- token/runtime statistics if available;
- deterministic score;
- validation error;
- retry count.

Make this available to the dashboard.

Prefer SSE for live updates unless another mechanism has a strong reason.

---

# 14. HISTORICAL RUNS

Dashboard must allow inspecting past runs.

Create pages such as:

```text
Runs
Jobs
Applications
CVs
Sources
System
```

For Runs show:

- run ID;
- stage;
- trigger;
- started;
- ended;
- duration;
- result;
- processed;
- failures.

Clicking a run should reveal all related events.

---

# 15. ANALYTICS

Display useful job-search statistics.

At minimum:

### Today

- vacancies discovered;
- unique vacancies;
- analyzed;
- AUTO_APPLY;
- REVIEW;
- STRETCH;
- REJECT;
- CVs created;
- applications started;
- submitted;
- waiting for user;
- failures.

### Cumulative

Same categories.

### Conversion

Where outcomes exist:

```text
applications
→ recruiter reply
→ HR screen
→ technical interview
→ offer
```

Also expose breakdowns already supported by reporting:

- role family;
- source;
- fit band;
- work format;
- seniority;
- CV version.

Do not pretend sparse statistics are meaningful.

Respect existing minimum sample handling.

---

# 16. DISCOVERY V2

The current real registry containing three boards is an integration smoke test, not acceptable job-market coverage.

Expand discovery substantially.

We want jobs relevant to:

### Primary

- Mechanical Engineering
- Mechanical Design
- R&D
- Product Development
- Simulation / CAE
- Test / Validation
- Automotive
- Aerospace
- Robotics
- Automation

### Software / data

- Python
- ML
- Data Science
- Research Engineering
- Scientific/Technical Software
- Embedded Software
- Graphics / Performance
- Technical Game Development

### Bridge

- IT support
- systems administration
- deployment automation
- technical support

### Cross-disciplinary

- mechanical + software
- simulation + Python
- robotics + software
- embedded + mechanical
- digital engineering

Work location priorities remain:

1. worldwide remote usable while residing in Poland;
2. Europe/EU remote usable from Poland;
3. Poland remote;
4. Wrocław ±30 km hybrid;
5. rare-travel hybrid elsewhere in Poland;
6. interesting European hybrid/onsite roles may be discovered but route to REVIEW unless relocation is explicitly approved.

Do NOT hardcode only title keyword searches.

Use broad employer/ATS coverage.

Expand official/public ATS feeds where legitimately available.

Support many boards/config entries rather than three companies.

Do not violate robots/access restrictions or bypass protected APIs.

Create source-health metrics:

- last success;
- last failure;
- jobs returned;
- response latency;
- error rate.

Expose this in dashboard.

---

# 17. DISCOVERY ACCEPTANCE TARGET

The goal is not an arbitrary exact number, but the resulting discovery set should clearly be broad enough to search the market rather than three employers.

The report should include:

```text
number of sources
number of employers
raw vacancies
unique vacancies
role-family distribution
country distribution
work-format distribution
```

I expect the source set to be orders of magnitude broader than the current three-board smoke test.

If a broad source cannot be used legally/reliably, document why rather than bypassing restrictions.

---

# 18. CV FACTORY V2

Current CV generation is too conservative.

Fact selection is good.

Keep factual grounding.

But implement genuine vacancy-specific tailoring.

For every generated CV, create:

### Vacancy-specific headline

Do not blindly use the exact employer job title if a more truthful candidate headline is appropriate.

Never inflate seniority.

### Professional summary

A short tailored summary generated only from verified facts.

### Skills section

Order and include skills according to vacancy relevance.

Do not add unsupported skills.

### Experience/project selection

Choose the most relevant professional experience and projects.

### Controlled bullet rewriting

You MAY rewrite factual statements for clarity and relevance.

But every rewritten bullet must retain explicit source fact IDs.

Create verification that rewritten statements are semantically supported by those facts.

A stronger Ollama model may be used for CV writing.

The 4B model may remain the extraction/matching model.

Do not let the strong writer introduce new facts.

Use:

```text
LLM_FAST_MODEL
LLM_STRONG_MODEL
```

for their appropriate roles.

---

# 19. CV DIFFERENTIATION

A mechanical role and Python role should produce visibly different CVs.

For example:

### Mechanical / R&D vacancy

Prioritize:

- mechanical engineering;
- Fusion/CAD;
- cycloidal gearbox;
- turbojet;
- simulation;
- FEA;
- CFD;
- FLOW-3D;
- PLC/automation where relevant.

### ML / research software

Prioritize:

- Python;
- XAUUSD research;
- data pipeline;
- experimentation;
- ML architectures;
- statistics;
- ARC where applicable.

### Automation

Prioritize:

- PLC;
- ESP32;
- PID;
- sensors;
- robotics;
- workstation/deployment automation where applicable.

### IT/system role

Prioritize:

- professional hospital IT;
- Windows;
- Active Directory;
- LAN;
- deployment;
- internal software/automation where factually professional.

---

# 20. COVER LETTER / APPLICATION TEXT

Add support for generating grounded:

- short cover letter;
- motivation answer;
- "Why are you interested?";
- short professional introduction.

These should be produced only when required by an application or useful for a vacancy.

Same rule:

every factual claim must come from the fact store.

No generic long AI essays.

Aim for concise human-sounding text.

---

# 21. CV QA V2

Preserve current QA and add:

- PDF renders correctly;
- 1–2 pages;
- no placeholders;
- candidate identity present;
- contacts present;
- no unsupported skill;
- no unsupported employer;
- no unsupported years;
- no seniority inflation;
- degree-in-progress remains degree-in-progress;
- professional vs project provenance is preserved;
- relevant vacancy terminology is represented where supported;
- page visual sanity check.

Save:

- JSON;
- HTML;
- PDF;
- manifest;
- source fact map.

Expose all of this in dashboard.

---

# 22. REAL ATS COMPATIBILITY HARNESS

The existing mock form proves the state machine.

Now measure real-world form compatibility.

Do NOT submit anything.

Build a dry-run compatibility harness that opens real application forms for a diverse sample of public vacancies.

Target initially:

- Greenhouse;
- Lever;
- Ashby;
- SmartRecruiters;
- Teamtailor;
- Workday where possible;
- other common European ATS encountered during discovery.

For every tested vacancy record stages such as:

```text
APPLICATION_PAGE_OPENED
FORM_DETECTED
FIELDS_PARSED
IDENTITY_FIELDS_RESOLVED
CV_UPLOAD_AVAILABLE
CV_UPLOAD_SUCCEEDED
MULTISTEP_NAVIGATION_WORKED
FINAL_REVIEW_REACHED
BLOCKED_REASON
```

Final Submit must never occur.

---

# 23. ATS ADAPTER STRATEGY

Do not weaken the generic browser network boundary merely to support one ATS.

Instead introduce reviewed per-ATS adapters where needed.

For example:

```text
generic
greenhouse
lever
ashby
smartrecruiters
teamtailor
workday
```

Each adapter should explicitly know what reversible draft/autosave actions are safe.

A POST request required for an intermediate step may only be enabled when the adapter explicitly establishes that it is reversible and non-submitting.

No pattern like:

```text
allow all POST because ATS needs POST
```

is acceptable.

Expose adapter used in dashboard.

---

# 24. ATS COMPATIBILITY METRICS

Produce a report such as:

```text
Greenhouse:
  tested: 10
  form detected: 10
  CV upload: 9
  final review reached: 8

Lever:
  ...

Workday:
  ...
```

Categorize failures:

- auth required;
- CAPTCHA;
- iframe;
- unsupported widget;
- unsupported autosave;
- unsupported navigation;
- consent needs user;
- missing candidate fact;
- browser/security policy;
- vacancy closed;
- other.

The dashboard should display these metrics.

---

# 25. APPLICATION PRIORITY V2

Do not use only `overall_fit`.

Introduce a transparent priority model.

Consider at least:

- qualification fit;
- career alignment;
- work-format preference;
- employment feasibility;
- freshness;
- source confidence;
- vacancy status confidence.

Salary may contribute only when known.

Later outcome response rates can contribute once sample size is sufficient.

Keep this deterministic and inspectable.

Dashboard should show the components of the priority score.

Do not let a high-fit generic IT support role automatically outrank a slightly lower-fit high-value R&D role simply because of qualification percentage.

---

# 26. ANALYSIS RETRY / DEAD LETTER

Improve transient Stage 3 failure handling.

Add something equivalent to:

```text
analysis_attempt_count
last_analysis_error
next_analysis_retry_at
```

Distinguish:

### Retryable
- Ollama timeout;
- temporary Ollama failure;
- transient internal error.

### Non-retryable until something changes
- schema semantic failure after allowed retries;
- corrupt vacancy;
- invalid candidate facts;
- configuration error.

Use bounded retries/backoff.

Do not create infinite loops.

Expose failed/dead-letter analyses in dashboard.

---

# 27. TELEGRAM DURABILITY

Review current Telegram update handling.

Implement either:

- durable polling offset;

or preferably

- webhook-based delivery if suitable for local deployment.

Persist enough state to avoid processing old Telegram updates after restart.

Existing `application_questions` correlation remains authoritative.

Dashboard and Telegram must operate on the same pending-question records.

---

# 28. PROFILE / ONBOARDING SUPPORT

Do not invent missing real-candidate information.

Create a clean onboarding status page in dashboard.

Show missing global fields such as:

- legal name;
- email;
- phone;
- LinkedIn;
- GitHub;
- portfolio;
- exact employment dates;
- notice period;
- earliest start;
- B2B willingness;
- contractor willingness;
- EOR willingness;
- relocation willingness;
- UK/Switzerland authorization.

Missing fields must not block discovery.

Only block actions that actually need them.

Do not replace UNKNOWN automatically.

---

# 29. POSSIBLE PROFESSIONAL WEB APPLICATION FACT

The current candidate seed includes React/Django apps as PERSONAL_PROJECT.

Do not silently change this.

However, document this candidate-profile question clearly:

> Were any React/Django/internal web tools actually created as part of professional hospital employment?

If yes, the candidate profile should later allow those verified facts to be represented as PROFESSIONAL.

Do not assume the answer.

---

# 30. DASHBOARD SECURITY

Dashboard is an administration interface containing personal information.

Therefore:

- bind locally by default;
- never expose publicly without explicit configuration;
- require authentication/token;
- no secrets in client-side JavaScript;
- no `.env` display;
- no Ollama raw prompts containing PII unless sanitized;
- no browser cookies/storage state display;
- no password fields;
- no auth tokens;
- no unrestricted SQL endpoint;
- no arbitrary browser action endpoint;
- no arbitrary filesystem reads.

Sensitive logs should be minimized.

Follow existing browser PII retention.

---

# 31. DASHBOARD UX

Do not spend the entire run building fancy visuals.

Functionality > decoration.

But it should feel like a coherent admin/control system.

Desired layout roughly:

```text
┌──────────────────────────────────────────────┐
│ JobHunter   RUNNING     DRY RUN      21:43 │
├──────────┬───────────────────────────────────┤
│ Overview │                                   │
│ Pipeline │       ACTIVE PIPELINE             │
│ Jobs     │                                   │
│ Apps     │ DISCOVERY → ANALYSIS → CV → APP │
│ HITL     │                 ↑ active          │
│ Runs     │                                   │
│ Sources  │       LIVE CURRENT ACTION         │
│ CVs      │                                   │
│ System   │       BROWSER PREVIEW             │
│          │                                   │
│          │       EVENTS / LOG                │
└──────────┴───────────────────────────────────┘
```

Responsive desktop-first UI is sufficient.

Dark mode is welcome but not necessary.

---

# 32. TESTS

Add meaningful automated tests.

Do not inflate test count with trivial tests.

Important new tests:

### Dashboard API

- unauthorized access rejected;
- no secrets returned;
- correct pipeline state;
- run/event filtering;
- application timeline;
- candidate fact lookup;
- pause/resume;
- trigger validation.

### CV v2

- different role families produce materially different CVs;
- no unsupported facts;
- rewritten bullets trace to source facts;
- professional provenance cannot be fabricated;
- degree-in-progress remains truthful;
- ATS-supported terminology can be introduced only if supported.

### Discovery

- large registry;
- source-health tracking;
- source failure isolation;
- no private network fetch;
- rate limiting remains.

### ATS adapters

- no final submit in dry-run;
- only explicitly allowed reversible POSTs;
- generic adapter remains fail-closed;
- adapter boundaries tested.

### Analysis retry

- transient retry;
- bounded backoff;
- no infinite retry;
- semantic failure dead-letter.

---

# 33. REAL DRY-RUN ACCEPTANCE TEST

At the end perform one large final dry-run.

It must use:

- real PostgreSQL;
- real n8n;
- real local Ollama;
- real Core;
- real browser service;
- real dashboard;
- real candidate profile where fields are available;
- real public vacancy sources.

Absolutely no employer submission.

Acceptance should demonstrate:

### Discovery
Broad multi-employer discovery.

### Analysis
A representative set of vacancies from several role families.

### CV
At least:

- one mechanical/R&D CV;
- one automation/embedded CV;
- one Python/ML/technical software CV;

if suitable vacancies exist.

Demonstrate that their content differs appropriately while facts remain traceable.

### Browser
Attempt several real ATS forms.

Reach final review where safely supported.

### Dashboard
Record the whole process.

Provide screenshots of:

- overview;
- active pipeline;
- vacancy analysis;
- CV view;
- browser observer;
- application timeline;
- analytics.

---

# 34. DO NOT GAME ACCEPTANCE

Do not:

- inject a known target vacancy into ranking;
- force a vacancy to AUTO_APPLY;
- use fixture facts as real candidate facts;
- replace Ollama with a mock;
- mark unsupported ATS as PASS;
- mark manual takeover as automated success;
- call a page open "application compatibility";
- call 3 employer boards "broad discovery";
- silently skip failed sources;
- weaken browser security;
- perform a real Submit.

If something does not work, report it honestly.

---

# 35. REPORTING

Create a new major report, for example:

```text
docs/REAL_WORLD_READINESS_V2_REPORT.md
```

It must include:

## Environment
- OS
- Node
- n8n
- PostgreSQL
- Chromium
- Ollama
- fast model
- strong model
- git SHA

## Discovery
- sources;
- employers;
- raw jobs;
- unique jobs;
- errors;
- distribution.

## Analysis
- analyzed count;
- model failures;
- routing distribution;
- retry/dead-letter information.

## CV
- generated count;
- role-family examples;
- QA;
- factual validation.

## ATS compatibility
Results per ATS.

## Dashboard
Implemented views and controls.

## Remaining blockers
Be explicit.

## Submission
Must state:

```text
Real employer submissions performed: 0
```

---

# 36. GITHUB DISCIPLINE

Commit logical milestones separately.

Suggested commits:

1. observability/event API foundation;
2. dashboard skeleton + system overview;
3. live pipeline + browser observer;
4. vacancy/application/CV inspectors;
5. discovery v2;
6. CV Factory v2;
7. ATS adapter framework;
8. real ATS dry-run harness;
9. analysis retry + Telegram durability;
10. final integration/acceptance/report.

Do not use these exact commits if another split is more logical.

Keep `main` working.

At completion:

- run full test suite;
- run acceptance;
- update README;
- update architecture docs;
- push everything to GitHub.

---

# 37. FINAL RESPONSE FORMAT

Finish your response with:

## STATUS

One of:

```text
PASS
PARTIAL
FAIL
```

Do not call it PASS unless this entire new milestone genuinely passes.

Then report:

```text
Final commit:
<hash>

Tests:
<X passed / Y failed>

Discovery:
<sources / employers / raw / unique>

CV Factory:
<status>

ATS dry-run:
<summary>

Dashboard:
<status>

Real employer submissions:
0

Remaining blockers:
- ...
```

Also provide paths to all important reports/screenshots.

---

# CORE PRODUCT PRINCIPLE

The final system should feel less like:

> "an AI script that applies to jobs"

and more like:

> "a locally controlled autonomous recruitment operations system whose every action can be inspected, explained, paused, audited and overridden."

I want to be able to leave it running, open the dashboard, and immediately see:

- what it is doing;
- why;
- what it found;
- what it thinks about each vacancy;
- what facts it used;
- what CV it generated;
- what the browser currently sees;
- what field it is filling;
- where it is blocked;
- what it needs from me;
- what it did previously;
- what succeeded;
- what failed;
- what was actually submitted.

Preserve full factual integrity and fail-safe behavior while making the system genuinely useful in the real world.