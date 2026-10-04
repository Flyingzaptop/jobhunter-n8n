# Ollama Cloud inference

JobHunter supports three explicit `OLLAMA_PROVIDER` values. `local` remains the
default for legacy deployments. Cloud providers never fall back to local inference.

## Signed-in local relay

Use the existing Ollama sign-in with a small local HTTP relay:

```dotenv
OLLAMA_PROVIDER=cloud-relay
OLLAMA_BASE_URL=http://127.0.0.1:11434
LLM_FAST_MODEL=gemma4:cloud
LLM_STRONG_MODEL=gemma4:cloud
CV_WRITER_MODEL=gemma4:cloud
CV_VERIFIER_MODEL=gemma4:cloud
```

The relay only accepts a loopback endpoint and model names ending in `:cloud` or
`-cloud`. Before its first inference, the gateway verifies `/api/tags` metadata for
both configured models: `remote_host` must be `https://ollama.com` and
`remote_model` must identify a remote model. A suffix alone cannot authorize a
local alias. The proof is cached per immutable client configuration; an explicit
health check refreshes it. A missing or invalid manifest blocks inference.

For the current Gemma cloud manifest, `gemma4:cloud` maps to `gemma4:31b` and is
312 bytes of metadata. Cloud model weights run remotely. When keeping the local
GPU free, start `ollama serve` with `CUDA_VISIBLE_DEVICES=-1` and
`GGML_VK_VISIBLE_DEVICES=-1`; configure all four model settings with cloud names.
The gateway sends no Bearer key to the relay.

## Direct API

The direct API works without a local Ollama server:

```dotenv
OLLAMA_PROVIDER=cloud
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_API_KEY=<server-side API key>
LLM_FAST_MODEL=gemma4:31b
LLM_STRONG_MODEL=gemma4:31b
CV_WRITER_MODEL=gemma4:31b
CV_VERIFIER_MODEL=gemma4:31b
```

Use exact model names from `https://ollama.com/api/tags`. Direct mode requires the
exact HTTPS Ollama origin and a nonempty server-side key; alternate hosts, paths,
queries, fragments and embedded URL credentials are rejected. The key is held
in a private client field and used in Bearer headers for chat and health calls.
Every request rejects redirects. Keep the key out of browser configuration,
logs, source control and generated artifacts.

## Validation and input preservation

Ollama Cloud currently does not support the native structured-output `format`
parameter. Cloud requests embed the complete JSON schema in the system prompt,
request a single strict JSON result, and apply the same local Ajv schema and
semantic provenance validators as local mode. There are exactly two generation
attempts. Malformed JSON, extra properties, unsupported facts, semantic failures,
output exhaustion and HTTP errors fail closed after the retry; there is no fake
answer or local-model fallback.

A cloud response may wrap its complete JSON in a single Markdown fence with an
optional `json` marker. Only that whole-response wrapper is removed; prose
before or after it is rejected. Response content is bounded to 1 MiB before
parsing. HTTP failures expose a fixed `error.code`, such as `HTTP_429`, so a
caller can schedule a retry without recording service response text.

Cloud requests never unload a model, manipulate its cache, run native token
probes, or send `num_ctx`/`keep_alive`. The complete messages, schema and repair
instruction must fit the conservative 65,536-token budget computed from UTF-8
bytes plus output and framing allowances. Oversize input is rejected before
inference rather than shortened. Request statistics include provider/model
names (including the verified relay `remote_model`), attempt counts and numeric budgets; the context figure is an admission
budget, not a measured remote token count.

Structured fit prompts omit known names, legal names, emails and phone numbers
from candidate/onboarding/identity containers. Qualification facts, source
quotes, eligibility and vacancy text remain intact. Contact details are rendered
locally into CV artifacts. Cloud providers process the remaining submitted
evidence remotely. Public errors and `lastStats.validation_codes` contain fixed
category codes. The retry prompt alone receives up to eight schema diagnostics
(paths, keywords and missing fields) or a bounded `StructuredOutputError`
semantic diagnostic. These details are limited to 1,200 characters, omit raw
output and redact the API key, Bearer values and stripped candidate contacts.
They are never stored in request statistics or public errors. This gives the
model an actionable correction without weakening the validators.

`LLM_GATEWAY_VERSION` identifies gateway behavior for inference input hashes;
`lastStats.gateway_version` records the same version.

To create a client with scoped CV models while preserving its provider,
authentication and injected fetch transport, use `client.withModels(...)`.

## Offline regression checks

```powershell
node --test tests/ollama-cloud.test.mjs tests/stage3.test.mjs tests/cv-v2.test.mjs
```

These tests use mocked transports and exercise direct authentication, redirect
policy, relay manifest proof, endpoint restrictions, full input bounds, contact
omission, JSON/schema/semantic retries, safe errors and preserved local context
preflight. They do not load a GPU model or contact an inference service.

Official references: [Ollama Cloud](https://docs.ollama.com/cloud) and
[structured outputs](https://docs.ollama.com/capabilities/structured-outputs).
