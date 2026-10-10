# Idle-load and stalled-queue repair — 2026-10-10

The user requested a full stop first. The supervisor, workers, dashboard, browser service and its descendants, n8n, Telegram polling and PostgreSQL were stopped; Gemma was unloaded and its API server stopped. The hardware-pause and full-stop maintenance markers remain in place. **Do not clear them or start the campaign without a subsequent explicit resume request.**

Measured immediately after stopping: 0 headless Chromium processes, 0 PostgreSQL processes, no loaded LM Studio models, RAM 10.2/39.6 GiB (previously 36.8), GPU memory 303 MiB. `scripts/stop-independent.ps1` reproduces the full stop using the known service process trees, preserving the user's ordinary browser.

## Confirmed causes and changes

- Browser state retention only pruned files; it never retired live contexts. Context creation is now capped at four, including concurrent reservations. Failed navigation closes its context. Idle sessions checkpoint and close after two minutes. Model review holds a renewable lease so a slow, progressing local inference keeps its form. Terminal/unsupported application runs release their browser context. Dashboard hardware pause also stops descendants rather than leaving Chromium orphaned.
- A negative model review moved the application to FILLING, then a failed corrective action set its review to PENDING. Review workers selected only READY_TO_SUBMIT, while preparation remained parked. Corrections now wake preparation before execution; errors preserve CORRECTION_PENDING and their actual message. Repeated review failures back off and eventually stop that one application. Changed correction instructions invalidate the old generated answer.
- Stale profile drafts repeatedly threw PROFILE_CHANGED_REQUIRES_FRESH_FORM. A current verified CV now permits a fresh unsubmitted draft, revoking old review gates and discarding old form answers/document bindings. Any prior submit command prevents this reset.
- Transient browser errors now get bounded retries. Five existing unsubmitted failures were reset to OPENING in the paused database, and the stranded form correction was requeued. Previously attempted/ambiguous submissions are not replayed.
- Expensive preparation/phase/source queries were repeatedly scanned by many lanes. Shared in-flight/result caches, bulk work-key filtering, smaller connection budgets and idle/error backoff replace repeated per-item claims and tight loops. A preparation that never started is not recorded as completed.
- Source validation required compatible geography before admitting a job whose missing geography needed verification. Current non-rejected CVs with unresolved location now enter verification; explicit incompatible locations still fail. An explicit official REMOTE mode plus Poland-compatible applicant regions can resolve missing location fields, without inventing a hiring route or overriding explicit negative requirements.

Local configuration is now 2 preparation workers, 1 submission worker, 1 source verifier and a browser cap of 4. It is saved but not running.

## Funnel audit

The read-only snapshot was taken with only PostgreSQL briefly started, then stopped again:

- 140,008 canonical jobs.
- 120,961 low-priority screening records; 18,539 analyzed queue records; 457 source-access exceptions; 51 closed.
- Latest profile/source-current analyses: 13,058 REJECT, 1,295 REVIEW, 4,380 STRETCH. These analysis and queue populations differ; they are not interchangeable progress counters.
- 5,501 current verified CV versions for 5,500 distinct vacancies. There were 5,515 versions including historical documents.
- Of the current CVs, 901 had an application-enabled flag and 4,599 required source verification. Among 899 OPEN/application-enabled vacancies, 807 still lacked compatible location evidence. The flag alone was not sufficient to prepare an application.
- Before repair, only 226 source-verification candidates were visible; after repair, 5,406 entered the source-check candidate set. This is a queue, not proof that those jobs are suitable or applications ready.

## Validation and remaining acceptance

Passed isolated PostgreSQL tests for work leases, selecting beyond obsolete analyses, correction recovery and once-only submission guards; Chromium tests for bounded context creation, failed-navigation cleanup, checkpointed idle retirement and model leases; unit tests for retries, caches, location rules, fresh-draft invalidation and correction-answer binding. The existing fixture application completed its browser/DB workflow. Temporary test services were closed afterward; no live model was loaded.

The 40 previously unsupported external form routes have not been demonstrated end-to-end by this repair. The campaign remains stopped. No additional real submission, overnight throughput, or two-hour acceptance run is claimed. Any resumed acceptance run must report source verification, form preparation, submission receipts and resource usage separately.
