import Ajv from 'ajv';

const ajv = new Ajv({allErrors: true, strict: true});

export class StructuredOutputError extends Error {
  constructor(message = 'Structured LLM output failed validation') {
    super(message); this.name = 'StructuredOutputError';
  }
}

/** Real local Ollama JSON gateway. Exactly two attempts; no mock fallback. */
export class OllamaClient {
  constructor({baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    model = process.env.LLM_FAST_MODEL || 'qwen3.5:4b',
    strongModel = process.env.LLM_STRONG_MODEL || model, timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 240000),
    fetchImpl = globalThis.fetch} = {}) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Invalid Ollama endpoint');
    if (!['localhost','127.0.0.1','[::1]','host.docker.internal','ollama'].includes(url.hostname)
      && !/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname))
      throw new Error('Ollama must remain on a local/private endpoint');
    this.baseUrl = url.href.replace(/\/$/, ''); this.model = model;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new Error('Invalid Ollama timeout');
    this.strongModel = strongModel; this.timeoutMs = timeoutMs; this.fetch = fetchImpl;
  }

  async json({system, prompt, schema, validate, strong = false, numCtx = 16384, numPredict, repairInstruction}) {
    const check = ajv.compile(schema);
    this.lastStats = {semantic_attempts:0, native_context_probes:0, timeout_ms:this.timeoutMs, requests:[]};
    let previous = '', retryReason = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const messages = [{role: 'system', content: system}, {role: 'user', content: prompt},
          ...(attempt ? [{role: 'user', content: `Previous output did not pass validation: ${retryReason}. Generate a fresh complete result using the ORIGINAL vacancy and facts. ${repairInstruction || 'source_quote must be copied EXACTLY from the vacancy, never paraphrased. Extract every mandatory requirement separately. Return valid schema JSON, supported IDs and honest provenance only.'}`}] : [])];
        // A token cannot encode less than one UTF-8 byte. This conservative
        // byte bound preserves all supplied facts, including the repair turn,
        // instead of relying on a character/token guess which can truncate.
        const inputBytes = messages.reduce((total, message) => total + Buffer.byteLength(message.content, 'utf8'), 0);
        const neededContext = inputBytes + (numPredict || 4096) + 2048;
        let context = Math.max(numCtx, 2 ** Math.ceil(Math.log2(neededContext)));
        if (context > 65536) throw new StructuredOutputError('Structured request exceeds the validated 65536-token local context budget; no facts were truncated');
        const selectedModel = strong ? this.strongModel : this.model;
        let measuredInput = null;
        if (context > 32768) {
          // Exclusive local model use: clear its cache before trusting native
          // prompt_eval_count, so older runners cannot report cache misses only.
          const unload = await this.fetch(`${this.baseUrl}/api/chat`, {method:'POST',
            headers:{'content-type':'application/json'}, signal:AbortSignal.timeout(10000),
            body:JSON.stringify({model:selectedModel, messages:[], stream:false, keep_alive:0})});
          if (!unload.ok) throw new StructuredOutputError(`Ollama context probe unload HTTP ${unload.status}`);
          await unload.json();
          const probe = await this.fetch(`${this.baseUrl}/api/chat`, {method:'POST',
            headers:{'content-type':'application/json'}, signal:AbortSignal.timeout(this.timeoutMs),
            body:JSON.stringify({model:selectedModel, stream:false, think:false, format:schema,
              options:{temperature:0, num_ctx:context, num_predict:1}, messages})});
          this.lastStats.native_context_probes++;
          if (!probe.ok) throw new StructuredOutputError(`Ollama context probe HTTP ${probe.status}`);
          const measured = await probe.json();
          measuredInput = measured.prompt_eval_count;
          if (!Number.isInteger(measuredInput) || measuredInput <= 0 || measuredInput > inputBytes + 2048
            || (measured.prompt_eval_cached_count ?? 0) !== 0)
            throw new StructuredOutputError('Native context probe did not establish a complete uncached input-token count');
          context = Math.max(numCtx, 2 ** Math.ceil(Math.log2(measuredInput + (numPredict || 4096) + 2048)));
        }
        this.lastStats.requests.push({attempt:attempt+1, context_tokens:context, input_utf8_bytes:inputBytes,
          measured_input_tokens:measuredInput});
        this.lastStats.semantic_attempts++;
        const response = await this.fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST', headers: {'content-type': 'application/json'},
          signal: AbortSignal.timeout(this.timeoutMs),
          body: JSON.stringify({model: strong ? this.strongModel : this.model,
            stream: false, think: false, format: schema,
            options: {temperature: 0, num_ctx: context, ...(numPredict ? {num_predict: numPredict} : {})}, messages})
        });
        if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
        const envelope = await response.json();
        previous = envelope.message?.content ?? envelope.response ?? '';
        if (envelope.done_reason === 'length')
          throw new StructuredOutputError(`LLM output token budget exhausted (${envelope.eval_count ?? 'unknown'} tokens)`);
        const result = JSON.parse(previous);
        if (!check(result)) throw new StructuredOutputError(`LLM JSON schema mismatch: ${check.errors.map(e => `${e.instancePath || '/'} ${e.keyword}`).join('; ')}`);
        if (validate) await validate(result);
        return result;
      } catch (error) {
        retryReason = error instanceof StructuredOutputError ? error.message : error.name || 'Error';
        // Do not log prompts, profile, model content, headers or personal identifiers.
        if (attempt === 1) throw new StructuredOutputError(`Ollama failed after 2 attempts (${error instanceof StructuredOutputError ? error.message : error.name || 'Error'})`);
      }
    }
  }

  async health() {
    const response = await this.fetch(`${this.baseUrl}/api/tags`, {signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error(`Ollama health HTTP ${response.status}`);
    const {models = []} = await response.json();
    const names = models.map(x => x.name);
    return {ok: names.includes(this.model) && names.includes(this.strongModel),
      fast_model: this.model, strong_model: this.strongModel, available_models: names};
  }
}

export const createOllamaClient = options => new OllamaClient(options);
