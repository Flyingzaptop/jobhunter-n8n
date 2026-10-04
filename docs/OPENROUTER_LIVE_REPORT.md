# OpenRouter migration — 2026-10-04

The user's saved key authenticated successfully (HTTP 200). The public model
catalog confirms `google/gemma-4-26b-a4b-it:free`, zero prompt/completion prices,
262,144 context and JSON-object support. A real trivial inference returned HTTP
200, the exact requested free model and valid JSON. No paid model, local Ollama
model or alternate-model fallback is used.

Fit/CV clients now use OpenRouter. Native schema enforcement is not advertised
by this free model; complete schema instructions, Ajv, exact source/fact validation
and bounded semantic repair remain active. Keys remain in ignored `.env` and are
not exposed by the dashboard or diagnostics.

Real full-vacancy requests currently receive HTTP 429 from the Google AI Studio
upstream provider. Account inspection separately reports 2/50 free requests used,
48 remaining at this snapshot, so this is not a claim that the account's daily
quota is exhausted. Failed results are not accepted as analyses. Queue retries
are persisted; the batch stops after the first rate limit rather than consuming
the remaining allowance in a rapid loop. HTTP 429 does not enable a paid fallback.

Regression snapshot: 223/223 PostgreSQL/Chromium tests passed, zero skips. The
OpenRouter-specific suite adds endpoint, private-key, zero-price, response-envelope,
reasoning exclusion, quota deferral, JSON/schema/semantic and no-fallback checks.
Live smoke is separate from these mocked regression transports.

The previous Ollama work is preserved: 153 distinct Gemma fit records at v3.1 and
three actual source-bound candidate CV/PDF artifacts. They are historical evidence,
not fabricated OpenRouter results. Real employer submissions remain zero.

References: [model](https://openrouter.ai/google/gemma-4-26b-a4b-it:free),
[limits](https://openrouter.ai/docs/api/reference/limits).
