import Ajv from 'ajv';
import {persistModelProgress} from './model-progress.mjs';
import {compactPromptSchema} from './prompt-schema.mjs';

const ajv = new Ajv({allErrors: true, strict: true});
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const CLOUD_IDENTITY_KEYS = new Set(['name','legal_name','full_name','first_name','last_name','email','phone','phone_number']);
export const LLM_GATEWAY_VERSION = 'llm-json-v5-lmstudio-local';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1';
const OPENROUTER_DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it:free';
const freeModel = name => typeof name === 'string' && name.length <= 150
  && /^[a-zA-Z0-9][a-zA-Z0-9._/-]*:free$/.test(name);
const zeroPrice = value => (typeof value === 'string' || typeof value === 'number')
  && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) === 0;
const tokenCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const retryDelay = value => ((typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))
  || typeof value === 'number') && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 604800
  ? Math.ceil(Number(value)) : null;

function retryAfter(response) {
  try { return retryDelay(response.headers?.get?.('retry-after')); } catch { return null; }
}

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

/** Structured JSON gateway. At most two attempts; no mock, paid or local fallback. */
export class OllamaClient {
  #apiKey;
  #relayVerified = false;
  #relayRemoteModels = {};
  #openRouterVerified = false;
  #openRouterModels = {};
  #lmStudioVerified = false;
  constructor({provider = process.env.OLLAMA_PROVIDER || 'local',
    baseUrl = (provider === 'lmstudio' ? process.env.LM_STUDIO_BASE_URL || process.env.LMSTUDIO_BASE_URL : provider === 'openrouter' ? process.env.OPENROUTER_BASE_URL : process.env.OLLAMA_BASE_URL)
      || (provider === 'lmstudio' ? 'http://127.0.0.1:1234/v1' : provider === 'openrouter' ? OPENROUTER_ENDPOINT : provider === 'cloud' ? 'https://ollama.com' : 'http://127.0.0.1:11434'),
    apiKey = provider === 'openrouter' ? process.env.OPENROUTER_API_KEY : process.env.OLLAMA_API_KEY,
    model = process.env.LLM_FAST_MODEL || (provider === 'openrouter' ? OPENROUTER_DEFAULT_MODEL : provider === 'cloud' ? 'gemma4:31b' : provider === 'cloud-relay' ? 'gemma4:cloud' : 'qwen3.5:4b'),
    strongModel = process.env.LLM_STRONG_MODEL || model, timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 240000),
    contextLimit = Number(process.env.LM_STUDIO_CONTEXT_LENGTH || process.env.LMSTUDIO_CONTEXT_LIMIT || 32768),
    structuredFormat = process.env.LMSTUDIO_STRUCTURED_FORMAT || 'json_schema',
    tokenCounter,
    sdkPredict,
    fetchImpl = globalThis.fetch} = {}) {
    if (!['local','cloud','cloud-relay','openrouter','lmstudio'].includes(provider)) throw new Error('Invalid Ollama provider');
    let url;
    try { url = new URL(baseUrl); } catch { throw new Error('Invalid Ollama endpoint'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Invalid Ollama endpoint');
    if (provider !== 'local' && ![model,strongModel].every(name => typeof name === 'string' && name.length <= 150
      && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(name))) throw new Error('Invalid Ollama cloud model name');
    if (provider === 'lmstudio') {
      if (!LOOPBACK_HOSTS.includes(url.hostname) || !['/v1','/v1/'].includes(url.pathname) || url.search || url.hash)
        throw new Error('LM Studio requires a loopback /v1 endpoint');
      if (!Number.isInteger(contextLimit) || contextLimit < 1024 || contextLimit > 65536)
        throw new Error('Invalid LM Studio loaded context limit');
      if (!['json_schema','strict_json'].includes(structuredFormat)) throw new Error('Invalid LM Studio structured format');
    } else if (provider === 'openrouter') {
      if (url.href !== OPENROUTER_ENDPOINT && url.href !== `${OPENROUTER_ENDPOINT}/`)
        throw new Error('OpenRouter requires exact https://openrouter.ai/api/v1 endpoint');
      if (typeof apiKey !== 'string' || !apiKey || /\s/.test(apiKey))
        throw new Error('OpenRouter requires server-only OPENROUTER_API_KEY');
      if (![model,strongModel].every(freeModel)) throw new Error('OpenRouter requires exclusively :free model names');
      this.#apiKey = apiKey;
    } else if (provider === 'cloud') {
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
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > (provider === 'lmstudio' ? 3600000 : 600000))
      throw new Error('Invalid Ollama timeout');
    this.timeoutMs = timeoutMs; this.fetch = fetchImpl;
    this.contextLimit = contextLimit; this.structuredFormat = structuredFormat;
    this.tokenCounter = tokenCounter;
    this.sdkPredict = sdkPredict;
  }

  withModels({model = this.model, strongModel = this.strongModel} = {}) {
    return new OllamaClient({provider:this.provider, baseUrl:this.baseUrl, apiKey:this.#apiKey,
      model,strongModel,timeoutMs:this.timeoutMs,contextLimit:this.contextLimit,structuredFormat:this.structuredFormat,tokenCounter:this.tokenCounter,sdkPredict:this.sdkPredict,fetchImpl:this.fetch});
  }

  requestOptions(options = {}) {
    return {...options, redirect:'error', headers:{...options.headers,
      ...(['cloud','openrouter'].includes(this.provider) ? {authorization:`Bearer ${this.#apiKey}`} : {})}};
  }

  async json(input){
    const controller=new AbortController();let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new StructuredOutputError('Inference operation deadline exceeded');error.code='INFERENCE_TIMEOUT';
      if(this.lastStats?.validation_codes&&!this.lastStats.validation_codes.includes('INFERENCE_TIMEOUT'))this.lastStats.validation_codes.push('INFERENCE_TIMEOUT');
      const request=this.lastStats?.requests?.at(-1);if(request){request.stage='timeout';request.elapsed_ms=Date.now()-Date.parse(request.started_at??new Date().toISOString());if(this.fetch===globalThis.fetch&&!this.sdkPredict)persistModelProgress(this.lastStats.model,request);}
      controller.abort(error);reject(error);},this.timeoutMs);});
    try{return await Promise.race([this.#jsonOperation({...input,requestSignal:controller.signal}),timeout]);}
    finally{clearTimeout(timer);}
  }
  async #jsonOperation({system, prompt, schema, validate, strong = false, numCtx = 16384, numPredict, repairInstruction,requestSignal}) {
    const check = ajv.compile(schema);
    const lmStudio = this.provider === 'lmstudio';
    const cloud = !['local','lmstudio'].includes(this.provider);
    const redactedValues = [this.#apiKey];
    const selectedModel = strong ? this.strongModel : this.model;
    this.lastStats = {provider:this.provider, model:selectedModel,
      ...(cloud ? {remote_model:['cloud','openrouter'].includes(this.provider) ? selectedModel : this.#relayRemoteModels[selectedModel] ?? null} : {}),
      gateway_version:LLM_GATEWAY_VERSION, validation_codes:[],
      semantic_attempts:0, native_context_probes:0, timeout_ms:this.timeoutMs, requests:[]};
    if (cloud) {
      if (!Number.isInteger(numCtx) || numCtx < 1024 || numCtx > 65536
        || (numPredict !== undefined && (!Number.isInteger(numPredict) || numPredict < 1 || numPredict > 32768)))
        throw new StructuredOutputError('Invalid cloud context/output budget');
      prompt = cloudPrompt(prompt,redactedValues);
      system = `${system}\nReturn exactly one JSON value satisfying the following JSON Schema. No Markdown, commentary or extra properties. Keep all original facts and source quotes intact.\nJSON Schema:\n${JSON.stringify(schema)}`;
    }
    if (lmStudio) system = `${system}\nReturn exactly one JSON value satisfying this JSON Schema. No Markdown, commentary or extra properties. Preserve all facts and source quotes. Resolve $ref against $defs.\nJSON Schema:\n${JSON.stringify(compactPromptSchema(schema))}`;
    let previous = '', retryReason = '', retryDetails = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      let failureCode = 'REQUEST_FAILED';
      let failureDiagnostics = '';
      let retryAfterSeconds = null;
      try {
        requestSignal.throwIfAborted();
        const messages = [{role: 'system', content: system}, {role: 'user', content: prompt},
          ...(attempt ? [{role: 'user', content: `Previous output did not pass validation: ${retryReason}${retryDetails ? `; ${retryDetails}` : ''}. Generate a fresh complete result using the ORIGINAL vacancy and facts. ${repairInstruction || 'source_quote must be copied EXACTLY from the vacancy, never paraphrased. Extract every mandatory requirement separately. Return valid schema JSON, supported IDs and honest provenance only.'}`}] : [])];
        // A token cannot encode less than one UTF-8 byte. This conservative
        // byte bound preserves all supplied facts, including the repair turn,
        // instead of relying on a character/token guess which can truncate.
        const inputBytes = messages.reduce((total, message) => total + Buffer.byteLength(message.content, 'utf8'), 0);
        const neededContext = inputBytes + (numPredict || 4096) + 2048;
        let context = Math.max(numCtx, 2 ** Math.ceil(Math.log2(neededContext)));
        let measuredInput = null;
        failureCode = 'INPUT_BUDGET_EXCEEDED';
        if (!lmStudio && context > 65536) throw new StructuredOutputError(`Structured request exceeds the validated 65536-token ${cloud ? 'cloud' : 'local'} context budget; no facts were truncated`);
        if (lmStudio) {
          let completeInputBudget = neededContext;
          // Native tokenizer is read-only and resolves an already loaded instance.
          // Production must inspect the actual loaded context, which can change
          // independently of configuration after a user reloads the model.
          if (this.tokenCounter || this.fetch === globalThis.fetch || neededContext > this.contextLimit) {
            failureCode = 'NATIVE_TOKEN_COUNT_UNVERIFIED';
            const measuring=this.tokenCounter ? this.tokenCounter({model:selectedModel,messages,baseUrl:this.baseUrl})
              : this.fetch === globalThis.fetch ? this.#measureLMStudioInput(selectedModel,messages) : Promise.resolve(null);
            let probeTimer;
            const measured=await Promise.race([measuring,new Promise((_,reject)=>{probeTimer=setTimeout(()=>{const failure=new StructuredOutputError('Native budget probe timed out');failure.code='NATIVE_TOKEN_COUNT_UNVERIFIED';reject(failure);},Math.min(30000,this.timeoutMs));})]).finally(()=>clearTimeout(probeTimer));
            requestSignal.throwIfAborted();
            if (measured && Number.isSafeInteger(measured.inputTokens) && measured.inputTokens > 0
              && Number.isSafeInteger(measured.contextLength) && measured.contextLength > 0) {
              measuredInput = measured.inputTokens;
              completeInputBudget = measuredInput + (numPredict || 4096) + 2048;
              context = Math.min(this.contextLimit,measured.contextLength);
            } else throw new StructuredOutputError('LM Studio native token count unavailable; no facts were truncated');
          } else context = this.contextLimit;
          failureCode = 'INPUT_BUDGET_EXCEEDED';
          if (!Number.isInteger(numCtx) || numCtx < 1024 || numCtx > this.contextLimit
            || (numPredict !== undefined && (!Number.isInteger(numPredict) || numPredict < 1))
            || completeInputBudget > context)
            throw new StructuredOutputError('LM Studio request exceeds the configured loaded context budget; no facts were truncated');
        }
        failureCode = 'REQUEST_FAILED';
        if (lmStudio && !this.#lmStudioVerified) {
          failureCode = 'LMSTUDIO_MODEL_UNVERIFIED';
          if (!(await this.health()).ok) throw new StructuredOutputError('LM Studio configured model is not available');
          failureCode = 'REQUEST_FAILED';
        }
        if (this.provider === 'openrouter' && !this.#openRouterVerified) {
          failureCode = 'OPENROUTER_FREE_MODEL_UNVERIFIED';
          if (!(await this.health()).ok) throw new StructuredOutputError('OpenRouter free model catalog is not verified');
          failureCode = 'REQUEST_FAILED';
        }
        if (this.provider === 'openrouter') {
          const metadata = this.#openRouterModels[selectedModel];
          if (!freeModel(selectedModel) || !metadata) {
            failureCode = 'OPENROUTER_FREE_MODEL_UNVERIFIED';
            throw new StructuredOutputError('OpenRouter free model catalog is not verified');
          }
          const outputLimit = numPredict || 4096;
          failureCode = 'INPUT_BUDGET_EXCEEDED';
          if ((Number.isInteger(metadata.context_length) && neededContext > metadata.context_length)
            || (Number.isInteger(metadata.top_provider?.max_completion_tokens)
              && outputLimit > metadata.top_provider.max_completion_tokens))
            throw new StructuredOutputError('OpenRouter request exceeds verified model token limits');
          failureCode = 'REQUEST_FAILED';
        }
        if (this.provider === 'cloud-relay' && !this.#relayVerified) {
          failureCode = 'CLOUD_RELAY_UNVERIFIED';
          if (!(await this.health()).ok) throw new StructuredOutputError('Ollama cloud relay manifest is not verified');
          failureCode = 'REQUEST_FAILED';
        }
        if (this.provider === 'cloud-relay') this.lastStats.remote_model = this.#relayRemoteModels[selectedModel];
        if (this.provider === 'local' && context > 32768) {
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
        const openRouter = this.provider === 'openrouter';
        const sdkInference = lmStudio && (this.sdkPredict || this.fetch === globalThis.fetch);
        requestSignal.throwIfAborted();
        const response = sdkInference ? await this.#lmStudioSDKResponse({model:selectedModel,messages,schema,numPredict,outerSignal:requestSignal})
          : await this.fetch(`${this.baseUrl}${openRouter || lmStudio ? '/chat/completions' : '/api/chat'}`, this.requestOptions({
          method: 'POST', headers: {'content-type': 'application/json'},
          signal: AbortSignal.timeout(this.timeoutMs),
          body: JSON.stringify(lmStudio ? {model:selectedModel, stream:false, temperature:0,
            max_tokens:numPredict || 4096,
            ...(this.structuredFormat === 'json_schema' ? {response_format:{type:'json_schema',json_schema:{name:'jobhunter_result',strict:true,schema}}} : {}),
            messages} : openRouter ? {model:selectedModel, stream:false, temperature:0,
            max_tokens:numPredict || 4096, reasoning:{enabled:false,exclude:true},
            response_format:{type:'json_object'}, transforms:[],
            provider:{max_price:{prompt:0,completion:0}}, messages} : {model: selectedModel,
            stream: false, think: false, ...(!cloud ? {format: schema} : {}),
            options: {temperature: 0, ...(!cloud ? {num_ctx: context} : {}), ...(numPredict ? {num_predict: numPredict} : {})}, messages})
        }));
        if (!response.ok) {
          failureCode = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? `HTTP_${response.status}` : 'HTTP_ERROR';
          if (openRouter && failureCode === 'HTTP_429') retryAfterSeconds = retryAfter(response);
          throw new Error(`Ollama HTTP ${response.status}`);
        }
        failureCode = 'INVALID_RESPONSE';
        const envelope = await response.json();
        if (lmStudio) {
          if (envelope?.error || envelope?.model !== selectedModel || !Array.isArray(envelope?.choices) || envelope.choices.length !== 1)
            throw new StructuredOutputError('LM Studio returned an unexpected model or response envelope');
          this.lastStats.requests.at(-1).usage = {
            prompt_tokens:tokenCount(envelope.usage?.prompt_tokens), completion_tokens:tokenCount(envelope.usage?.completion_tokens),
            total_tokens:tokenCount(envelope.usage?.total_tokens)};
        }
        if (openRouter) {
          if (envelope?.error) {
            const status = Number(envelope.error.code);
            failureCode = Number.isInteger(status) && status >= 100 && status <= 599 ? `HTTP_${status}` : 'INVALID_RESPONSE';
            if (failureCode === 'HTTP_429') retryAfterSeconds = retryAfter(response)
              ?? retryDelay(envelope.error.metadata?.retry_after_seconds);
            throw new StructuredOutputError('OpenRouter returned an error envelope');
          }
          if (!Array.isArray(envelope?.choices) || envelope.choices.length !== 1)
            throw new StructuredOutputError('OpenRouter returned an invalid response envelope');
          if (typeof envelope.model !== 'string'
            || ![selectedModel,selectedModel.replace(/:free$/, '')].includes(envelope.model))
            throw new StructuredOutputError('OpenRouter returned an unexpected model');
          this.lastStats.remote_model = envelope.model;
          this.lastStats.requests.at(-1).usage = {
            prompt_tokens:tokenCount(envelope.usage?.prompt_tokens),
            completion_tokens:tokenCount(envelope.usage?.completion_tokens),
            total_tokens:tokenCount(envelope.usage?.total_tokens)};
          if (envelope.usage?.cost !== undefined && !zeroPrice(envelope.usage.cost)) {
            failureCode = 'OPENROUTER_NONFREE_USAGE';
            throw new StructuredOutputError('OpenRouter returned nonzero usage cost');
          }
        }
        previous = openRouter || lmStudio ? envelope.choices[0]?.message?.content : envelope.message?.content ?? envelope.response ?? '';
        if ((openRouter || lmStudio ? envelope.choices[0]?.finish_reason : envelope.done_reason) === 'length') {
          failureCode = 'OUTPUT_BUDGET_EXHAUSTED';
          throw new StructuredOutputError(`LLM output token budget exhausted (${envelope.eval_count ?? 'unknown'} tokens)`);
        }
        if ((openRouter || lmStudio) && (envelope.choices[0]?.finish_reason !== 'stop' || typeof previous !== 'string'))
          throw new StructuredOutputError('OpenRouter returned an incomplete response');
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
        if (lmStudio && (error?.code === 'INFERENCE_TIMEOUT' || ['TimeoutError','AbortError'].includes(error?.name)))
          failureCode = 'INFERENCE_TIMEOUT';
        if (this.provider === 'openrouter' && /^HTTP_[1-5][0-9]{2}$/.test(error?.code || '')) failureCode = error.code;
        if (this.provider === 'openrouter' && failureCode === 'HTTP_429') {
          retryAfterSeconds ??= retryDelay(error?.metadata?.retry_after_seconds);
          if (retryAfterSeconds !== null) this.lastStats.retry_after_seconds = retryAfterSeconds;
        }
        retryReason = cloud || lmStudio ? failureCode : error instanceof StructuredOutputError ? error.message : error.name || 'Error';
        if (lmStudio) {
          if(failureCode!=='INFERENCE_TIMEOUT'||!this.lastStats.validation_codes.includes(failureCode))this.lastStats.validation_codes.push(failureCode);
          retryDetails = repairDiagnostics(error instanceof StructuredOutputError ? error.message : '',redactedValues);
        }
        if (cloud) {
          this.lastStats.validation_codes.push(failureCode);
          if (failureCode === 'SEMANTIC_VALIDATION_FAILED' && error instanceof StructuredOutputError)
            failureDiagnostics = error.message;
          // Actionable diagnostics remain ephemeral and model-facing only.
          // Public errors and statistics contain fixed category codes.
          retryDetails = repairDiagnostics(failureDiagnostics,redactedValues);
        }
        // Do not log prompts, profile, model content, headers or personal identifiers.
        // An immediate repair cannot resolve quota/authentication failures.
        // Let the queue persist RETRY and defer without consuming another call.
        const defer = (this.provider === 'openrouter'
          && ['HTTP_429','HTTP_401','HTTP_402','HTTP_403','OPENROUTER_NONFREE_USAGE'].includes(failureCode))
          || (lmStudio && failureCode === 'INFERENCE_TIMEOUT');
        if (attempt === 1 || defer) {
          const attempts = attempt + 1;
          const failure = new StructuredOutputError(`${lmStudio ? 'LM Studio' : this.provider === 'openrouter' ? 'OpenRouter' : 'Ollama'} failed after ${attempts} attempt${attempts === 1 ? '' : 's'} (${retryReason})`);
          if (cloud || lmStudio) failure.code = retryReason;
          if (retryAfterSeconds !== null) failure.metadata = {retry_after_seconds:retryAfterSeconds};
          throw failure;
        }
      }
    }
  }

  async #lmStudioSDKResponse({model,messages,schema,numPredict,outerSignal}) {
    const request = this.lastStats.requests.at(-1);
    const started = Date.now();
    const signal = AbortSignal.any([AbortSignal.timeout(this.timeoutMs),outerSignal]);
    Object.assign(request,{stage:'awaiting_inference',started_at:new Date(started).toISOString(),
      prompt_processing_progress:0,generated_fragments:0});
    const publish=()=>{if(this.fetch===globalThis.fetch&&!this.sdkPredict)persistModelProgress(model,request);};
    publish();
    const options = {enableThinking:false,temperature:0,maxTokens:numPredict || 4096,
      contextOverflowPolicy:'stopAtLimit',
      ...(this.structuredFormat === 'json_schema' ? {structured:{type:'json',jsonSchema:schema}} : {}),
      signal,
      onPromptProcessingProgress:(progress,details={})=>{
        request.stage='processing_prompt';
        if(typeof progress==='number' && Number.isFinite(progress) && progress>=0 && progress<=1)
          request.prompt_processing_progress=progress;
        publish();
        request.prompt_processing={cached_tokens:tokenCount(details.cachedTokenCount),
          total_tokens:tokenCount(details.totalPromptTokenCount),processed_tokens:tokenCount(details.processedPromptTokenCount),
          unprocessed_tokens:tokenCount(details.unprocessedPromptTokenCount)};
      },
      onFirstToken:()=>{request.stage='generating';request.time_to_first_token_ms=Date.now()-started;publish();},
      onPredictionFragment:()=>{request.generated_fragments++;request.last_progress_elapsed_ms=Date.now()-started;if(request.generated_fragments%50===0)publish();}};
    this.lastStats.transport = 'lmstudio-sdk';
    this.lastStats.enable_thinking = false;
    let result;
    let deadline;
    let pending;
    let cancelled=false;
    const cancel=()=>{if(cancelled)return;cancelled=true;if(typeof pending?.cancel==='function')try{Promise.resolve(pending.cancel()).catch(()=>{});}catch{}};
    signal.addEventListener('abort',cancel,{once:true});
    try {
      pending = this.sdkPredict ? this.sdkPredict({model,messages,options,baseUrl:this.baseUrl})
        : this.#predictLMStudio(model,messages,options);
      // Some SDK versions fail to reject the promise after aborting a queued or
      // generating prediction. A separate deadline must end our wait reliably.
      const timeout = new Promise((_,reject)=>{
        deadline=setTimeout(()=>{
          cancel();
          const error=new StructuredOutputError('LM Studio inference timed out');
          error.code='INFERENCE_TIMEOUT';
          reject(error);
        },this.timeoutMs);
      });
      result=await Promise.race([pending,timeout]);
    } catch(error) {
      const timedOut=signal.aborted || error?.code==='INFERENCE_TIMEOUT' || ['TimeoutError','AbortError'].includes(error?.name);
      request.stage=timedOut ? 'timeout' : 'failed';
      request.elapsed_ms=Date.now()-started;
      publish();
      if(timedOut) {
        const failure=new StructuredOutputError('LM Studio inference timed out');
        failure.code='INFERENCE_TIMEOUT';
        throw failure;
      }
      throw error;
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener('abort',cancel);
    }
    request.stage='completed';request.elapsed_ms=Date.now()-started;
    publish();
    const reason = result.stats?.stopReason;
    const finish = ['maxPredictedTokensReached','contextLengthReached'].includes(reason) ? 'length'
      : ['eosFound','stopStringFound'].includes(reason) ? 'stop' : 'incomplete';
    request.tokens_per_second = typeof result.stats?.tokensPerSecond === 'number' && Number.isFinite(result.stats.tokensPerSecond)
      ? result.stats.tokensPerSecond : null;
    return {ok:true,json:async()=>({model:result.modelInfo?.identifier,
      choices:[{message:{content:result.content},finish_reason:finish}],
      usage:{prompt_tokens:result.stats?.promptTokensCount,completion_tokens:result.stats?.predictedTokensCount,
        total_tokens:Number.isSafeInteger(result.stats?.promptTokensCount) && Number.isSafeInteger(result.stats?.predictedTokensCount)
          ? result.stats.promptTokensCount + result.stats.predictedTokensCount : undefined}})};
  }

  async #predictLMStudio(model,messages,options) {
    const {LMStudioClient,Chat} = await import('@lmstudio/sdk');
    const endpoint = new URL(this.baseUrl);
    const sdk = new LMStudioClient({baseUrl:`${endpoint.protocol === 'https:' ? 'wss:' : 'ws:'}//${endpoint.host}`});
    const handle = (await sdk.llm.listLoaded()).find(item => item.identifier === model);
    if (!handle) throw new StructuredOutputError('LM Studio exact configured instance is not already loaded');
    if(options.signal.aborted) throw options.signal.reason;
    const prediction=handle.respond(Chat.from(messages),options);
    const cancel=()=>{try { Promise.resolve(prediction.cancel()).catch(()=>{}); } catch {}};
    options.signal.addEventListener('abort',cancel,{once:true});
    try { return await prediction; }
    finally {options.signal.removeEventListener('abort',cancel);}
  }

  async #measureLMStudioInput(model,messages) {
    const {LMStudioClient,Chat} = await import('@lmstudio/sdk');
    const endpoint = new URL(this.baseUrl);
    const sdk = new LMStudioClient({baseUrl:`${endpoint.protocol === 'https:' ? 'wss:' : 'ws:'}//${endpoint.host}`});
    const loaded = await sdk.llm.listLoaded();
    const handle = loaded.find(item => item.identifier === model);
    if (!handle)
      throw new StructuredOutputError('LM Studio exact configured instance is not already loaded');
    const formatted = await handle.applyPromptTemplate(Chat.from(messages));
    const inputTokens = await handle.countTokens(formatted);
    const contextLength = await handle.getContextLength();
    return {inputTokens,contextLength};
  }

  async health() {
    if (this.provider === 'lmstudio') {
      this.#lmStudioVerified = false;
      const response = await this.fetch(`${this.baseUrl}/models`,this.requestOptions({signal:AbortSignal.timeout(10000)}));
      if (!response.ok) throw new Error(`LM Studio health HTTP ${response.status}`);
      const {data} = await response.json();
      if (!Array.isArray(data)) throw new Error('LM Studio health invalid response');
      const configured = [...new Set([this.model,this.strongModel])];
      const ok = configured.every(name => data.some(item => item?.id === name));
      this.#lmStudioVerified = ok;
      return {ok,provider:this.provider,fast_model:this.model,strong_model:this.strongModel,
        available_models:ok ? configured : [],configured_context_limit:this.contextLimit};
    }
    if (this.provider === 'openrouter') return this.#openRouterHealth();
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

  async #openRouterHealth() {
    this.#openRouterVerified = false;
    this.#openRouterModels = {};
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/models`, this.requestOptions({signal:AbortSignal.timeout(10000)}));
    } catch { throw new Error('OpenRouter health request failed'); }
    if (!response.ok) {
      const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
      const error = new Error(`OpenRouter health HTTP ${status ?? 'ERROR'}`);
      error.code = status ? `HTTP_${status}` : 'HTTP_ERROR';
      const delay = status === 429 ? retryAfter(response) : null;
      if (delay !== null) error.metadata = {retry_after_seconds:delay};
      throw error;
    }
    let data;
    try { ({data} = await response.json()); } catch { throw new Error('OpenRouter health invalid response'); }
    if (!Array.isArray(data)) throw new Error('OpenRouter health invalid response');
    const configured = [...new Set([this.model,this.strongModel])];
    const models = configured.map(name => data.find(item => item?.id === name));
    const ok = configured.every(freeModel) && models.every(item => item
      && zeroPrice(item.pricing?.prompt) && zeroPrice(item.pricing?.completion)
      && Array.isArray(item.supported_parameters) && item.supported_parameters.includes('response_format'));
    if (ok) {
      this.#openRouterVerified = true;
      this.#openRouterModels = Object.fromEntries(models.map(item => [item.id,{
        context_length:item.context_length,
        top_provider:{max_completion_tokens:item.top_provider?.max_completion_tokens}}]));
    }
    // Return configured and verified free IDs only; never expose the full catalog
    // as a list of alternative models that could introduce an unintended fallback.
    return {ok,provider:this.provider,fast_model:this.model,strong_model:this.strongModel,
      available_models:ok ? configured : []};
  }
}

export const createOllamaClient = options => new OllamaClient(options);
