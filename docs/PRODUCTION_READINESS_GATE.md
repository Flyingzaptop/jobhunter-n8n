# Production Readiness Gate — active run

The user's 2026-10-04 request supersedes the previous missing-identity blocker.
Actual supplied legal name, phone and email are saved in the ignored local
candidate profile. Other facts remain UNKNOWN until supplied; private contacts
are never committed.

Required sequence:

1. Complete actual onboarding and show unresolved fields.
2. Versioned cheap relevance queue over the real market with transparent reasons.
3. Hundreds of actual Qwen analyses from that queue, resumable and observed.
4. Calibration against explicitly reviewed real vacancy labels; agent-authored
   reference labels must not be described as human/user labels.
5. Three grounded real CV/PDF artifacts with factual and visual QA.
6. Greenhouse, Teamtailor and another ATS: fill, upload, navigate, final review,
   STOP. A CAPTCHA/authentication/access restriction requires human takeover.
7. Actual Telegram delivery, only after private credentials are configured.
8. Authenticated dashboard HITL using the same persisted question correlation.
9. First ten controlled real applications, each requiring explicit confirmation
   of the concrete application before Submit. AUTO_APPLY remains disabled.

Current verified preparation: identity QA PASS; deterministic relevance queue
13,911 screened, 586 initially queued; sequential actual Qwen batch in progress.
The assistant's manually reviewed 20 source/fact cases are explicitly labelled
ASSISTANT_MANUAL_REVIEW. They exposed a false completed-degree blocker on a
currently-pursuing student requirement; correction and fresh calibration are
recorded rather than silently accepting the old scores. The first actual PDF
is a policy-blocked Canonical document demonstration, not an employer-ready CV.

The dashboard now persists confirmed correlated answers and per-application
review approvals. `node --env-file=.env scripts/production-gate-status.mjs` shows
the actual evidence counters and unmet checks. `scripts/controlled-prepare.mjs`
accepts a real job UUID and a verified, current, employer-ready CV UUID; it creates
a marked preparation-only application, obeys pause, fills supported known fields,
and stops under dry-run. Rejected, stale, policy-blocked or unverified PDFs cannot
be used. No Submit endpoint is exposed.

The supplied captcha-solver repository was reviewed read-only. It uses an
anti-detect browser and harvests replayable challenge tokens/cookies. Those
capabilities are not integrated. CAPTCHA and access-control bypasses are not
performed; ordinary supported forms and human continuation are developed.

During preparation `DRY_RUN=true`, `ALLOW_REAL_SUBMIT=false` and the readiness
lock remain active. A future controlled submission needs a separate single-use,
fresh-review approval; a global switch is not an approval for ten applications.
