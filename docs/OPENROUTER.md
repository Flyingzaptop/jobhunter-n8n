# OpenRouter free Gemma gateway

JobHunter accepts `OLLAMA_PROVIDER=openrouter` through the existing `OllamaClient` interface. The provider name is retained in analysis metadata and the gateway version binds this migration into the analysis configuration hash.

Set these server environment variables in the ignored local `.env`:

```dotenv
OLLAMA_PROVIDER=openrouter
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEY=<server-only-key>
LLM_FAST_MODEL=google/gemma-4-26b-a4b-it:free
LLM_STRONG_MODEL=google/gemma-4-26b-a4b-it:free
LLM_TIMEOUT_MS=240000
```

Never copy the real key into documentation, logs, the dashboard, test fixtures or Git. The key is held in a private field and retained by `withModels()`. All requests refuse redirects and use the exact HTTPS API endpoint.

Before inference, `GET /models` must identify both configured `:free` models, advertise `response_format` support and declare zero prompt/completion prices. Health returns only configured verified free IDs. Chat requests use one model ID, zero `provider.max_price` for prompt/completion and no alternative model list. Failure cannot switch to a paid model, another model, Ollama or local GPU inference.

`POST /chat/completions` uses `response_format: {type: "json_object"}` and embeds the complete JSON Schema in the system instruction. The Gemma free catalog supports JSON-object mode; this gateway does not claim native JSON-Schema enforcement. The existing Ajv schema and semantic validators remain mandatory. A validation failure permits one fresh repair using the original facts, then fails closed. Requests specify `stream:false`, `temperature:0`, bounded `max_tokens`, `reasoning:{enabled:false,exclude:true}` and `transforms:[]` to prevent automatic middle-out prompt truncation. All supplied facts and exact source quotes remain intact; known candidate contact containers are minimized before cloud transmission.

Only `choices[0].message.content` is parsed. Output with `finish_reason:"length"`, other incomplete finish reasons, a substituted model, excessive bytes, positive reported usage cost, invalid schema or unsupported evidence is rejected. Public errors contain fixed codes, such as `HTTP_429`, so an outer scheduler can preserve a job and wait for a rate-limit reset. Statistics contain provider, requested/actual model, validation codes and integer token counts; they exclude prompts, model content, reasoning and error bodies.

Free-tier rate limits can stop a batch even while authentication and connectivity work. The verified account is on the free tier: OpenRouter documents 50 free requests per day for accounts below the $10 purchased-credit threshold, with a 20-request-per-minute limit. Upstream providers can impose additional limits even when a tiny connection check succeeds.

`HTTP_429` immediately defers after the first failed request. `HTTP_401`, `HTTP_402`, `HTTP_403` and unexpected nonfree usage also fail immediately. The gateway performs no rate-limit sleep. A scheduler should preserve the current job as `RETRY`, stop the batch on `HTTP_429` and resume after capacity returns. A valid numeric `Retry-After` header, or the error envelope's numeric `metadata.retry_after_seconds`, is retained as bounded `retry_after_seconds` metadata/statistics; raw error bodies are never persisted. Only JSON/schema/semantic repair and other transient failures permit a second attempt.

Run the focused offline checks with:

```powershell
node --test tests/openrouter.test.mjs tests/ollama-cloud.test.mjs tests/stage3.test.mjs
```

These tests use mocked HTTP responses and make no inference calls. `npm test` runs the complete suite.

Primary API references: [model catalog](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties), [JSON-object format and token parameters](https://openrouter.ai/docs/api_reference/parameters), [reasoning control](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [limits](https://openrouter.ai/docs/api-reference/limits).
