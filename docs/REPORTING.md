# Reporting periods, outcome conversion and exports

`WF-06-reporting-ledger` reads PostgreSQL and regenerates the CSV, Markdown ledger,
`summary.json` and `weekly_conversion.json` in `data/exports/` (or the configured
report output directory). It does not submit applications or change candidate facts.

The existing top-level summary fields remain cumulative for API compatibility.
`scope: cumulative`, `reporting_date` and `timezone: Europe/Warsaw` make that explicit.
`summary.daily` contains the actual local calendar day. Telegram labels the daily
and cumulative sections separately. `summary.cumulative` contains the same cumulative
metrics as the top level. All report components use one PostgreSQL MVCC snapshot.

| Metric | Daily definition |
|---|---|
| discovered | Raw records first ingested on the Warsaw date |
| unique | Canonical jobs first seen on the Warsaw date |
| analyzed | Distinct jobs whose latest analysis before the day-end cutoff was created that day |
| suitable | Those analyzed jobs routed AUTO_APPLY, REVIEW or STRETCH; separate bands are retained |
| submitted | Current SUBMITTED applications with submitted_at on that date |
| awaiting_user / manual_takeover / failed / skipped | Applications currently in the respective state and last updated on that date |
| CVs | CV versions created on that date |
| current_awaiting_user_backlog | Current NEEDS_USER + CAPTCHA_WAIT across all dates |

Calendar boundaries are converted in PostgreSQL with `AT TIME ZONE 'Europe/Warsaw'`;
they are not fixed 24-hour UTC offsets. Work-format/geography counts refer to analyzed
jobs in each period. Authorization rejection requires an explicit country-lock or
work-authorization blocker, rather than an inferred candidate nationality. Missing
classification stays UNKNOWN. Top rejection reasons are distinct saved reason codes
per rejected job, limited to the five most frequent.

`summary.weekly` and `weekly_conversion.json` use a Monday-start, week-to-date cohort
of applications submitted before the report date's following midnight. Stages count
distinct applications with explicitly recorded RECRUITER_REPLY, HR_SCREEN,
TECHNICAL_INTERVIEW, INTERVIEW_OTHER, OFFER or REJECTED outcomes. A later stage does
not fabricate earlier stages. Repeated events count once. Stages overlap and are
not an exclusive status distribution. Withdrawals and employer closures are also
shown. Pending means no outcome or latest NO_RESPONSE; latest UNKNOWN is separate.
Future-dated outcomes are excluded.

`outcome_activity` separately counts outcome stages recorded during the week across
all submitted applications, including earlier submission cohorts. This avoids hiding
recruiter responses to older applications. Cohort conversion rates use the cohort's
submitted count as denominator and are null for an empty cohort.

Breakdowns cover role family, final fit/routing band, first canonical source,
work-format class, seniority, CV template version and CV prompt version. By default
each group needs five applications before its funnel and rates are exposed.
Smaller groups expose only sample size and `sufficient_sample: false`. Missing
dimensions are labelled UNKNOWN with `missing_metadata: true`. Unknown CV prompt
versions are not invented: deterministic CVs lacking that manifest field stay UNKNOWN.
Application attributes use the latest saved analysis at or before submission
(or application start if submitted_at is absent), and the actual linked CV version.
Later analyses cannot rewrite an existing submitted application's cohort attribution.

The CSV retains original field names and adds `applied_at`, `role`, `notes`, cohort
dimensions and the required eligibility fields: `work_format_class`, `office_location`,
`onsite_frequency`, `employment_route`, `work_from_poland_allowed`, `relocation_required`.
Missing facts remain empty, and stored false booleans remain false. The Markdown
ledger lists confirmed SUBMITTED rows; CSV includes all application states and reasons.
Reruns regenerate from all persisted applications without duplicating ledger entries.

Each export is written to a unique temporary file beside its target, then renamed.
Readers never receive a partially written file. Files are individually atomic;
the directory is not an atomic multi-file bundle. Read summary.json after completion
when cross-file consistency is needed, and avoid concurrent report runs targeting the
same directory if a matched set of exports is required.

The report function accepts `{ date: 'YYYY-MM-DD', minSample: 5, weekly: true }`.
The default date is the current Warsaw day. `weekly: true` also sends the weekly
Telegram funnel; the JSON weekly report is regenerated on every run.

Validation:

```powershell
node --env-file=.env --test --test-concurrency=1 tests/reporting.test.mjs tests/reporting-periods.test.mjs
node --env-file=.env scripts/test-stage-6.mjs --skip-bootstrap
```

The unit/integration tests use isolated PostgreSQL schemas. They prove period
boundaries, reconciliation, outcome history, sparse-cohort handling and exports.
The Stage 6 fixture proves real n8n execution with seeded reporting records and
captured Telegram transport; it does not prove employer submissions or live Telegram
delivery. Scheduling and `/weekly` transport belong to the core/workflow integration.

Production limits: application statuses are mutable current snapshots. Backdated
reports cannot reconstruct every historical state transition without an event-history
query. Daily failed/waiting/skipped numbers describe current states updated that day,
not every transition that happened during the day. A production report still needs
confirmed submitted_at timestamps, real user-recorded outcomes, reliable source/CV
metadata, and live scheduling/delivery validation. Weekly cohorts are immature during
their first days; a small-sample threshold is not a statistical confidence guarantee.
