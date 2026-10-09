# Autonomous application run — 2026-10-09

Explicit user authorization is stored outside Git in `data/authorization/autonomous-applications.json`. The user authorized automatic employer submissions without separate per-application confirmation, and subsequently required a whole-form Gemma positive review before sending.

The continuous worker uses 12 preparation lanes, 4 submission lanes, 2 current-source validation lanes, one serialized local model lane, and the existing discovery/screening/notification lanes. All processes remain hidden under the independent Windows supervisor. CV preparation still uses verified artifacts; source-pending CVs are promoted only after current source and location evidence passes. A standing grant does not override uncertain submission results or already-submitted application identities.

Ordinary ungated browser Submit stays disabled. Automatic sends use the existing exact review-packet checks, private signed short-lived capability, immutable form/profile/CV bindings, command ledger and idempotency. Approval events use `USER_AUTONOMOUS`, separate from individual dashboard/Telegram approvals. Gemma review returns `{s:"+",changes:[]}` or `{s:"-",changes:[...]}`. A change to the form, CV, source-binding or candidate profile invalidates the plus. Negative corrections use verified values or regenerate grounded prose and then requeue the form. Unknown personal facts remain human questions; CAPTCHA and authentication remain manual.

`APPLICATION_FILL_ALL_FIELDS=true` includes optional questions, verified profile links, and generated cover-letter PDFs when requested. Internal search boxes and unnamed upload-widget helpers are excluded from the application. Conditional Other follow-ups use the observed parent choice. Unknown sensitive demographic selections use non-disclosure when that choice is offered. There is no fabricated work history, licence, graduation date or unverified personal product use.

Prose generation uses up to eight relevant source facts, 4k requested context, up to two short segments, a 256-token output cap and a 128-token independent-verifier cap. Whole-form review keeps the complete answer history and CV; its output cap is 384 tokens, with positives typically much shorter. No paid or cloud generation provider is used.

Telegram ready-card and per-success notifications are disabled. CAPTCHA, unknown personal questions and the owner-requested `?` summary remain available. Quiet notifications do not mean uncertain outcomes are silently declared submitted: they remain visible in dashboard and the submission ledger.

Public Himalayas source verification uses its documented free search API (https://himalayas.app/docs/remote-jobs-api). Blocked HTML is not treated as an empty market result. New geography restrictions and changed source text cause rejection or re-evaluation, never stale-CV promotion.

Live acceptance is ongoing. The first real optional narrative answers were generated and applied; a personally factual product-use question required the owner. No new confirmed application count is claimed solely from worker startup or unit tests.
