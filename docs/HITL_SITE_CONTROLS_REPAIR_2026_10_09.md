# Application question routing repair — 2026-10-09

Live browser snapshots identified three parked Jobicy applications whose only visible controls were site search and a Dark mode toggle. A hidden global resume-builder upload was also being treated as an employer attachment. These are now removed before form filling and model review; question persistence independently rejects site controls. Actual employer questions about themes/search remain eligible.

Three erroneous questions were closed without inventing answers, and their existing Telegram messages were corrected without new notifications. Retrying the Jobicy pages no longer asks about the controls or uploads a CV to the global helper. These pages still require an application route: they are `MANUAL_TAKEOVER / UNSUPPORTED_FORM`, not completed applications.

Explicitly confirmed product use is remembered separately from details of a particular product-use question. A supplied detailed answer takes precedence for the exact question; it is not borrowed for professional-use, duration or production-experience questions. Ashby's duplicate question/group title is treated as the same wording. Current answer memory is included in whole-form model review. Private applicant answers remain in PostgreSQL, not this report.

The affected ElevenLabs form was filled with the owner's actual answer and reached `READY_TO_SUBMIT` with all-fields checking enabled. No unanswered questions remained at the live check. A parked automatic-send task is requeued when the application becomes ready again; the normal model review, source validation and idempotent submit checks still apply. Readiness is not evidence of a completed submission.

Validation: regression tests for site controls versus genuine employer questions, product-use scope and answer reuse; an isolated PostgreSQL integration test for closure, source attribution, details and worker wake-up; existing PostgreSQL/Chromium application runner and prose integration tests. Core/dashboard/worker/Telegram run hidden under the independent supervisor. No scheduled task was added.
