import Ajv from 'ajv';

const ajv = new Ajv({allErrors: true, strict: true});
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const CLOUD_IDENTITY_KEYS = new Set(['name','legal_name','full_name','first_name','last_name','email','phone','phone_number']);
export const LLM_GATEWAY_VERSION = 'ollama-json-v3-cloud-repair';

function repairDiagnostics(text, redactedValues) {
  let cleaned = String(text);
  for (const value of redactedValues) if (typeof value === 'string' && value) cleaned = cleaned.split(value).join('[redacted]');
  return cleaned.replace(/\bBearer\s+\S+/gi,'Bearer [redacted]')
    .replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,1200);
}

function schemaDiagnostics(errors) {
  // Never copy additionalProperty, propertyName or received values from output.
  return errors.slice(0,8).map(error => `${String(error.instancePath || '/').slice(0,160)} ${error.keyword}`
    + (error.keyword === 'required' ? ` missing field ${String(error.params.missingProperty).slice(0,120)}` : '')).join('; ');
}

// Fit needs qualifications and provenance, not the contacts rendered locally.
// Only known identity containers are filtered; source quotes and fact names stay exact.
function cloudPrompt(prompt, redactedValues) {
  let value;
  try { value = JSON.parse(prompt); } catch { return prompt; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return prompt;
  function withoutContacts(container) {
    if (!container || typeof container !== 'object' || Array.isArray(container)) return container;
    return Object.fromEntries(Object.entries(container).filter(([key,item]) => {
      if (!CLOUD_IDENTITY_KEYS.has(key)) return true;
      if (typeof item === 'string' && item) redactedValues.push(item);
      return false;
    })
      .map(([key, item]) => [key, ['identity','contacts','contact'].includes(key) ? withoutContacts(item) : item]));
  }
  for (const key of ['candidate','onboarding','identity']) {
    if (Object.hasOwn(value, key)) value[key] = withoutContacts(value[key]);
  }
  return JSON.stringify(value);
}

export class StructuredOutputError extends Error {
  constructor(message = 'Structured LLM output failed validation') {
    super(message); this.name = 'StructuredOutputError';
  }
}

/** Real Ollama JSON gateway. Exactly two attempts; no mock or local fallback. */
export class OllamaClient {
  #apiKey;
  #relayVerified = false;
  #relayRemoteModels = {};
  constructor({provider = process.env.OLLAMA_PROVIDER || 'local',
    baseUrl = process.env.OLLAMA_BASE_URL || (provider === 'cloud' ? 'https://ollama.com' : 'http://127.0.0.1:11434'),
    apiKey = process.env.OLLAMA_API_KEY,
    model = process.env.LLM_FAST_MODEL || (provider === 'cloud' ? 'gemma4:31b' : provider === 'cloud-relay' ? 'gemma4:cloud' : 'qwen3.5:4b'),
    strongModel = process.env.LLM_STRONG_MODEL || model, timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 240000),
    fetchImpl = globalThis.fetch} = {}) {
    if (!['local','cloud','cloud-relay'].includes(provider)) throw new Error('Invalid Ollama provider');
    let url;
    try { url = new URL(baseUrl); } catch { throw new Error('Invalid Ollama endpoint'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Invalid Ollama endpoint');
    if (provider !== 'local' && ![model,strongModel].every(name => typeof name === 'string' && name.length <= 150
      && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(name))) throw new Error('Invalid Ollama cloud model name');
    if (provider === 'cloud') {
      if (url.href !== 'https://ollama.com/') throw new Error('Ollama Cloud requires exact https://ollama.com endpoint');
      if (typeof apiKey !== 'string' || !apiKey || /\s/.test(apiKey)) throw new Error('Ollama Cloud requires server-only OLLAMA_API_KEY');
      this.#apiKey = apiKey;
    } else if (provider === 'cloud-relay') {
      if (!LOOPBACK_HOSTS.includes(url.hostname) || url.pathname !== '/' || url.search || url.hash)
        throw new Error('Ollama cloud relay requires a loopback endpoint');
      if (![model,strongModel].every(name => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*(?:-cloud|:cloud)$/.test(name)))
        throw new Error('Ollama cloud relay requires exclusively cloud-suffixed model names');
    } else if (!['localhost','127.0.0.1','[::1]','host.docker.internal','ollama'].includes(url.hostname)
      && !/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname))
      throw new Error('Ollama must remain on a local/private endpoint');
    Object.defineProperties(this, Object.fromEntries(Object.entries({provider,baseUrl:url.href.replace(/\/$/, ''),model,strongModel})
      .map(([key,value]) => [key,{value,enumerable:true}])));
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new Error('Invalid Ollama timeout');
    this.timeoutMs = timeoutMs; this.fetch = fetchImpl;
  }

  withModels({model = this.model, strongModel = this.strongModel} = {}) {
    return new OllamaClient({provider:this.provider, baseUrl:this.baseUrl, apiKey:this.#apiKey,
      model,strongModel,timeoutMs:this.timeoutMs,fetchImpl:this.fetch});
  }

  requestOptions(options = {}) {
    return {...options, redirect:'error', headers:{...options.headers,
      ...(this.provider === 'cloud' ? {authorization:`Bearer ${this.#apiKey}`} : {})}};
  }

  async json({system, prompt, schema, validate, strong = false, numCtx = 16384, numPredict, repairInstruction}) {
    const check = ajv.compile(schema);
    const cloud = this.provider !== 'local';
    const redactedValues = [this.#apiKey];
    const selectedModel = strong ? this.strongModel : this.model;
    this.lastStats = {provider:this.provider, model:selectedModel,
      ...(cloud ? {remote_model:this.provider === 'cloud' ? selectedModel : this.#relayRemoteModels[selectedModel] ?? null} : {}),
      gateway_version:LLM_GATEWAY_VERSION, validation_codes:[],
      semantic_attempts:0, native_context_probes:0, timeout_ms:this.timeoutMs, requests:[]};
    if (cloud) {
      if (!Number.isInteger(numCtx) || numCtx < 1024 || numCtx > 65536
        || (numPredict !== undefined && (!Number.isInteger(numPredict) || numPredict < 1 || numPredict > 32768)))
        throw new StructuredOutputError('Invalid cloud context/output budget');
      prompt = cloudPrompt(prompt,redactedValues);
      system = `${system}\nReturn exactly one JSON value satisfying the following JSON Schema. No Markdown, commentary or extra properties. Keep all original facts and source quotes intact.\nJSON Schema:\n${JSON.stringify(schema)}`;
    }
    let previous = '', retryReason = '', retryDetails = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      let failureCode = 'REQUEST_FAILED';
      let failureDiagnostics = '';
      try {
        const messages = [{role: 'system', content: system}, {role: 'user', content: prompt},
          ...(attempt ? [{role: 'user', content: `Previous output did not pass validation: ${retryReason}${retryDetails ? `; ${retryDetails}` : ''}. Generate a fresh complete result using the ORIGINAL vacancy and facts. ${repairInstruction || 'source_quote must be copied EXACTLY from the vacancy, never paraphrased. Extract every mandatory requirement separately. Return valid schema JSON, supported IDs and honest provenance only.'}`}] : [])];
        // A token cannot encode less than one UTF-8 byte. This conservative
        // byte bound preserves all supplied facts, including the repair turn,
        // instead of relying on a character/token guess which can truncate.
        const inputBytes = messages.reduce((total, message) => total + Buffer.byteLength(message.content, 'utf8'), 0);
        const neededContext = inputBytes + (numPredict || 4096) + 2048;
        let context = Math.max(numCtx, 2 ** Math.ceil(Math.log2(neededContext)));
        failureCode = 'INPUT_BUDGET_EXCEEDED';
        if (context > 65536) throw new StructuredOutputError(`Structured request exceeds the validated 65536-token ${cloud ? 'cloud' : 'local'} context budget; no facts were truncated`);
        failureCode = 'REQUEST_FAILED';
        if (this.provider === 'cloud-relay' && !this.#relayVerified) {
          failureCode = 'CLOUD_RELAY_UNVERIFIED';
          if (!(await this.health()).ok) throw new StructuredOutputError('Ollama cloud relay manifest is not verified');
          failureCode = 'REQUEST_FAILED';
        }
        if (this.provider === 'cloud-relay') this.lastStats.remote_model = this.#relayRemoteModels[selectedModel];
        let measuredInput = null;
        if (!cloud && context > 32768) {
          // Exclusive local model use: clear its cache before trusting native
          // prompt_eval_count, so older runners cannot report cache misses only.
          const unload = await this.fetch(`${this.baseUrl}/api/chat`, this.requestOptions({method:'POST',
            headers:{'content-type':'application/json'}, signal:AbortSignal.timeout(10000),
            body:JSON.stringify({model:selectedModel, messages:[], stream:false, keep_alive:0})}));
          if (!unload.ok) throw new StructuredOutputError(`Ollama context probe unload HTTP ${unload.status}`);
          await unload.json();
          const probe = await this.fetch(`${this.baseUrl}/api/chat`, this.requestOptions({method:'POST',
            headers:{'content-type':'application/json'}, signal:AbortSignal.timeout(this.timeoutMs),
            body:JSON.stringify({model:selectedModel, stream:false, think:false, format:schema,
              options:{temperature:0, num_ctx:context, num_predict:1}, messages})}));
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
        const response = await this.fetch(`${this.baseUrl}/api/chat`, this.requestOptions({
          method: 'POST', headers: {'content-type': 'application/json'},
          signal: AbortSignal.timeout(this.timeoutMs),
          body: JSON.stringify({model: strong ? this.strongModel : this.model,
            stream: false, think: false, ...(!cloud ? {format: schema} : {}),
            options: {temperature: 0, ...(!cloud ? {num_ctx: context} : {}), ...(numPredict ? {num_predict: numPredict} : {})}, messages})
        }));
        if (!response.ok) {
          failureCode = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? `HTTP_${response.status}` : 'HTTP_ERROR';
          throw new Error(`Ollama HTTP ${response.status}`);
        }
        failureCode = 'INVALID_RESPONSE';
        const envelope = await response.json();
        previous = envelope.message?.content ?? envelope.response ?? '';
        if (envelope.done_reason === 'length') {
          failureCode = 'OUTPUT_BUDGET_EXHAUSTED';
          throw new StructuredOutputError(`LLM output token budget exhausted (${envelope.eval_count ?? 'unknown'} tokens)`);
        }
        failureCode = 'JSON_PARSE_ERROR';
        if (cloud) {
          failureCode = 'OUTPUT_SIZE_EXCEEDED';
          if (typeof previous !== 'string' || Buffer.byteLength(previous,'utf8') > 1048576)
            throw new StructuredOutputError('Cloud response exceeds the output byte limit');
          failureCode = 'JSON_PARSE_ERROR';
          // Some cloud models fence otherwise-valid JSON. Accept only a fence
          // wrapping the entire response, never extract a JSON substring from prose.
          const fenced = previous.trim().match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
          if (fenced) previous = fenced[1];
        }
        const result = JSON.parse(previous);
        failureCode = 'SCHEMA_VALIDATION_FAILED';
        if (!check(result)) {
          failureDiagnostics = schemaDiagnostics(check.errors);
          throw new StructuredOutputError(`LLM JSON schema mismatch: ${check.errors.map(e => `${e.instancePath || '/'} ${e.keyword}`).join('; ')}`);
        }
        failureCode = 'SEMANTIC_VALIDATION_FAILED';
        if (validate) await validate(result);
        return result;
      } catch (error) {
        retryReason = cloud ? failureCode : error instanceof StructuredOutputError ? error.message : error.name || 'Error';
        if (cloud) {
          this.lastStats.validation_codes.push(failureCode);
          if (failureCode === 'SEMANTIC_VALIDATION_FAILED' && error instanceof StructuredOutputError)
            failureDiagnostics = error.message;
          // Actionable diagnostics remain ephemeral and model-facing only.
          // Public errors and statistics contain fixed category codes.
          retryDetails = repairDiagnostics(failureDiagnostics,redactedValues);
        }
        // Do not log prompts, profile, model content, headers or personal identifiers.
        if (attempt === 1) {
          const failure = new StructuredOutputError(`Ollama failed after 2 attempts (${retryReason})`);
          if (cloud) failure.code = retryReason;
          throw failure;
        }
      }
    }
  }

  async health() {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/api/tags`, this.requestOptions({signal: AbortSignal.timeout(10000)}));
    } catch { throw new Error('Ollama health request failed'); }
    if (!response.ok) throw new Error(`Ollama health HTTP ${response.status}`);
    let models;
    try { ({models = []} = await response.json()); }
    catch { throw new Error('Ollama health invalid response'); }
    if (!Array.isArray(models)) throw new Error('Ollama health invalid response');
    const names = models.map(x => x.name);
    const ok = names.includes(this.model) && names.includes(this.strongModel)
      && (this.provider !== 'cloud-relay' || [this.model,this.strongModel].every(name => {
        const remote=models.find(model => model.name === name);
        return ['https://ollama.com','https://ollama.com/'].includes(remote?.remote_host)
          && typeof remote?.remote_model === 'string' && remote.remote_model.length <= 150
          && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(remote.remote_model);
      }));
    if (this.provider === 'cloud-relay') {
      this.#relayVerified = ok;
      this.#relayRemoteModels = ok ? Object.fromEntries([this.model,this.strongModel].map(name =>
        [name,models.find(model => model.name === name).remote_model])) : {};
    }
    return {ok, provider:this.provider,
      fast_model: this.model, strong_model: this.strongModel, available_models: names};
  }
}

export const createOllamaClient = options => new OllamaClient(options);
