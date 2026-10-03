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
    strongModel = process.env.LLM_STRONG_MODEL || model, timeoutMs = 120000,
    fetchImpl = globalThis.fetch} = {}) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Invalid Ollama endpoint');
    if (!['localhost','127.0.0.1','[::1]','host.docker.internal','ollama'].includes(url.hostname)
      && !/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname))
      throw new Error('Ollama must remain on a local/private endpoint');
    this.baseUrl = url.href.replace(/\/$/, ''); this.model = model;
    this.strongModel = strongModel; this.timeoutMs = timeoutMs; this.fetch = fetchImpl;
  }

  async json({system, prompt, schema, validate, strong = false}) {
    const check = ajv.compile(schema);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST', headers: {'content-type': 'application/json'},
          signal: AbortSignal.timeout(this.timeoutMs),
          body: JSON.stringify({model: strong ? this.strongModel : this.model,
            stream: false, think: false, format: schema,
            options: {temperature: 0, num_ctx: 16384},
            messages: [{role: 'system', content: system}, {role: 'user', content: prompt},
              ...(attempt ? [{role: 'user', content: 'Previous output did not pass validation. Return valid schema JSON, supported IDs, exact quotes and honest provenance only.'}] : [])]})
        });
        if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
        const envelope = await response.json();
        const result = JSON.parse(envelope.message?.content ?? envelope.response ?? '');
        if (!check(result)) throw new StructuredOutputError('LLM JSON schema mismatch');
        if (validate) await validate(result);
        return result;
      } catch (error) {
        // Do not log prompts, profile, model content, headers or personal identifiers.
        if (attempt === 1) throw new StructuredOutputError(`Ollama failed after 2 attempts (${error.name || 'Error'})`);
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
