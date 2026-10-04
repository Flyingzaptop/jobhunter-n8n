# Dashboard HITL and specific application review

This addition accepts explicit applicant answers on the existing persisted
`application_questions` row. It introduces no independent answer memory or
candidate-fact editing system. Telegram and dashboard share the same acceptance
helper, exact request correlation, single-answer transaction, and dispatch claim.

## Applicant answer flow

`POST /api/hitl/questions/:question_id/answer` requires an authenticated operator,
valid session CSRF token, and exactly `{answer, expected_request_id, confirmed:true}`.
The server resolves the application from the question; the request cannot supply
another application, candidate profile, field selector, or arbitrary private value.
The question must belong to the active profile, remain unanswered, and match the
application's actual pending request while its state is `NEEDS_USER`.

The dashboard shows the exact question and a bounded text input, then a review
step with an explicit confirmation checkbox. Nothing supplies a guessed answer
for salary, legal, location, availability, or consent questions. The saved text is
the applicant's answer, source `USER_DASHBOARD`, confidence 1, and `reusable=false`.
No answer changes the candidate profile or becomes a reusable answer implicitly.

CAPTCHA, password, OTP, authentication codes, sensitive security/bank identifiers,
and stale/foreign/non-pending questions are rejected. Manual takeover remains
manual. Answer text is stored only in the question; audit events carry identifiers
and source, never the answer. Vacancy text is rendered as text, not executable HTML.

`application_answer_receipts` atomically records PENDING dispatch with acceptance.
The default dashboard callback notifies the fixed local authenticated core route
`POST /hitl/dispatch {question_id}` using the server-only `CORE_SERVICE_TOKEN`.
Core owns the single dispatch claim. The dashboard does not claim twice or call
the browser directly. A failed notification leaves durable work for core recovery.
RUNNING/ambiguous dispatch is never blindly retried.

## Integration helpers

`services/core/hitl.mjs` exports:

- `acceptQuestionAnswerWithClient(client,input)` for the existing Telegram durable
  inbox transaction; caller owns BEGIN/COMMIT.
- `answerApplicationQuestion(repository,input)` for an owned acceptance transaction.
- `dispatchQuestionAnswer(repository,questionId,dispatch)` for one PENDING claim;
  returns dispatch status plus callback result. Failure becomes
  `MANUAL_RECONCILIATION`, not automatic retry.
- `recoverPendingQuestionAnswers(repository,dispatch,{limit})` claims only bounded
  PENDING work and separately exposes RUNNING/reconciliation records.
- `persistPendingApplicationQuestion(...)` persists correlation before any optional
  Telegram notification. Existing root Telegram integration can retain its
  equivalent durable question-creation implementation.

Acceptance input uses `{questionId,correlationId,answer,source,profileId}` with source
`USER_DASHBOARD` or `USER_TELEGRAM`. A transactional caller must use the currently
active verified profile, not a profile supplied by an external answer request.

## Specific application review preparation

The application inspector supports authenticated CSRF-protected:

- `POST /api/applications/:id/review/prepare {}`
- `POST /api/applications/:id/review/approve {approval_id,binding_digest,confirmed:true}`
- `POST /api/applications/:id/review/revoke {approval_id}`
- `GET /api/applications/:id/review` reads the current profile's recorded reviews.

Preparation requires `READY_TO_SUBMIT`, no pending/unanswered questions, an OPEN
vacancy verified within 15 minutes, a full claims/identity/PDF QA PASS, exact current
profile version, approved PDF path/bytes/hash, the current browser session/form,
no CAPTCHA/authentication/validation blocker, and required field answers. An
uploaded CV must match the reviewed PDF. Employer anti-AI attestation conditions
remain blocked for manual review; this implementation never signs an attestation.

The persisted preparation binds hashes of the job, verified profile, actual CV
bytes, and form fields/answers/session. The UI requires explicit review confirmation.
Approval rechecks the fresh binding and expires after 15 minutes. The campaign is
capped at ten APPROVED/CONSUMED specific reviews under a database advisory lock.
Consumed reviews cannot be reused or prepared again for the same application.
Revoke and prepare/approve produce append-only audit events.

**All these endpoints are preparation/review only. They do not click Submit,
enable AUTO_APPLY, change real-submit settings, or mark Production Gate 1–8 PASS.**
The UI labels approval as “review approval recorded,” never submission readiness.

`consumeApplicationReview(...)` is an integration helper only. It fails unless root
injects a successful `assertProductionGate` callback, then rechecks the binding and
atomically consumes a still-valid APPROVED row. Root must call it within the
existing application mutex immediately before any separately authorized future
Submit. Existing browser Submit permission, consent, and ambiguity protections
must still pass. No dashboard endpoint exposes consumption or actual Submit.

## Validation and evidence limits

`node --env-file=.env --test tests/dashboard-hitl.test.mjs` uses a uniquely named
isolated PostgreSQL schema, isolated admin session, actual compiled React UI, and
explicit regression-only artifacts. It tests concurrent Telegram/dashboard
answers, exact correlation, secret/foreign/stale rejection, durable single dispatch,
ambiguous-dispatch recovery, HTTP auth/CSRF/POST boundaries, explicit UI confirmation,
plain-text XSS handling, fresh digest rejection, one-time consume, and ten-review cap.
It performs no actual employer submission or Telegram/browser external action.

These are regression checks, not real ATS/final-review production evidence.
The live dashboard's production readiness still depends on root's separate gates.
Telegram credentials and actual delivery are not created or claimed by this change;
secrets remain server-side ignored local configuration, never client storage or DB.
