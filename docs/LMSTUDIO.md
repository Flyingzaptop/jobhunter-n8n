# Local LM Studio provider

Set `OLLAMA_PROVIDER=lmstudio`, `LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1`, and both `LLM_FAST_MODEL` and `LLM_STRONG_MODEL` to the exact ID returned by `/v1/models`. The gateway accepts loopback endpoints only and never switches models or providers. `LMSTUDIO_BASE_URL` is accepted as an alias.

Load the model with a 32768-token context in LM Studio and leave it loaded. Set `LM_STUDIO_CONTEXT_LENGTH=32768` to match that loaded runtime (`LMSTUDIO_CONTEXT_LIMIT` is an alias). The gateway does not unload the model, probe Ollama, or attempt to increase its runtime context. It conservatively checks the complete input UTF-8 byte count plus output allowance and framing reserve against the configured loaded context, and fails without truncating facts if it cannot establish room.

If the byte bound exceeds that limit, the installed `@lmstudio/sdk` resolves only the exact already loaded instance from `listLoaded()`, applies its native chat template to the complete messages, counts tokens and reads the actual context length. The complete native count plus output allowance and 2048-token reserve must fit both actual and configured limits. No SDK `model()` or `load()` call is made. The native approach follows [LM Studio's tokenization documentation](https://lmstudio.ai/docs/typescript/tokenization); actual measured input tokens are recorded in request stats.

`LMSTUDIO_STRUCTURED_FORMAT=json_schema` (default) sends OpenAI-compatible strict JSON Schema response formatting. If the selected runtime does not support this, explicitly configure `LMSTUDIO_STRUCTURED_FORMAT=strict_json`; this uses schema instructions with the same Ajv and application semantic validation. No automatic mode or provider fallback occurs. Both modes allow at most one complete repair attempt and reject incomplete output or an unexpected returned model ID.

The model is kept resident by LM Studio's runtime configuration. Requests do not include unload instructions or modify idle TTL. Verify the loaded model and TTL with LM Studio before a production run. Stats identify `provider=lmstudio` and the local model, without remote-model provenance.
