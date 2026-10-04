# Windows update handoff — 2026-10-04

User requested saving current progress and stopping all work before updating
Windows. JobHunter is paused, batch authorization disabled, and services stopped.
PostgreSQL received CHECKPOINT and a clean `pg_ctl` fast shutdown. A physical
cluster backup is stored under ignored `data/backups`; restore with the same
PostgreSQL major version. PDF artifacts remain in ignored `data/cv-v2`.

Checkpoint: `data/runtime/windows-update-checkpoint.json`. Latest Cloud receipts
include 153 distinct jobs on Gemma for fit v3.1; these are processed jobs, not a
claim that all are suitable or information-complete. Three actual candidate PDFs
(Linear, Waymo, Bosch) passed factual/contact/PDF and rendered-page inspection.
The older Canonical PDF remains a separate policy-blocked demonstration. Real
employer submissions remain zero.

On explicit resume, replace Ollama with OpenRouter. The user's supplied credential
is stored only in the ignored local `.env` as `OPENROUTER_API_KEY`. Never print,
commit or expose it in frontend code. Exact free model ID/availability for the
requested Gemma 4 26B A4B must be verified against OpenRouter's current catalog.
The OpenRouter adapter has not been implemented or exercised during this stop.

Keep source/fact validation, current analysis/profile/CV/form bindings, dry-run
and individual-review safeguards. Preserve all saved analyses and retry receipts;
relevant hashes must reflect the new provider/model. No new local inference or
Cloud request should start until the user explicitly resumes after Windows update.
