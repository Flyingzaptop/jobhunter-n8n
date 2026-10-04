import test from 'node:test';
import assert from 'node:assert/strict';
import {OllamaClient,StructuredOutputError} from '../services/core/llm.mjs';

const model = 'gemma4-26b-a4b-qat-uncensored-hauhaucs-balanced-mtp';
const schema = {type:'object',properties:{quote:{type:'string'}},required:['quote'],additionalProperties:false};
test('small prompts respect actual loaded context even when configured context is larger',async()=>{
  let measured=0;
  const {client,calls}=harness([],{contextLimit:32768,tokenCounter:async()=>{
    measured++;return {inputTokens:100,contextLength:4096};
  }});
  await assert.rejects(client.json({system:'Extract',prompt:'Python',schema}),{code:'INPUT_BUDGET_EXCEEDED'});
  assert.ok(measured>0);
  assert.equal(calls.length,0);
});
test('only LM Studio permits an explicit local one-hour timeout',()=>{
  const client=new OllamaClient({provider:'lmstudio',model,timeoutMs:3600000});
  assert.equal(client.timeoutMs,3600000);
  assert.equal(client.withModels().timeoutMs,3600000);
  assert.throws(()=>new OllamaClient({provider:'lmstudio',model,timeoutMs:3600001}),/Invalid Ollama timeout/);
  for(const timeoutMs of [999,NaN,1000.5])
    assert.throws(()=>new OllamaClient({provider:'lmstudio',model,timeoutMs}),/Invalid Ollama timeout/);
  assert.throws(()=>new OllamaClient({provider:'local',model,timeoutMs:600001}),/Invalid Ollama timeout/);
  assert.throws(()=>new OllamaClient({provider:'openrouter',model:'google/gemma-4-26b-a4b-it:free',apiKey:'test-key',timeoutMs:600001}),/Invalid Ollama timeout/);
});
function harness(outputs, options = {}) {
  const calls = [];
  const client = new OllamaClient({provider:'lmstudio',model,strongModel:model,...options,fetchImpl:async (url,init) => {
    calls.push({url,...init,body:init.body && JSON.parse(init.body)});
    if (url.endsWith('/models')) return {ok:true,json:async()=>({data:[{id:model}]})};
    return {ok:true,json:async()=>({model,choices:[{message:{content:outputs.shift()},finish_reason:'stop'}],usage:{prompt_tokens:12}})};
  }});
  return {client,calls};
}
test('LM Studio uses exact local model and JSON Schema, keeps identity and local provenance',async()=>{
  const {client,calls} = harness(['{"quote":"Python"}']);
  assert.deepEqual(await client.json({system:'Extract',prompt:'{"candidate":{"name":"Alice"},"text":"Python"}',schema}),{quote:'Python'});
  assert.equal(calls.length,2);
  const request = calls[1];
  assert.equal(request.url,'http://127.0.0.1:1234/v1/chat/completions');
  assert.equal(request.body.response_format.type,'json_schema');
  assert.equal(request.body.model,model);
  assert.match(request.body.messages[1].content,/Alice/);
  assert.equal(client.lastStats.native_context_probes,0);
  assert.equal(Object.hasOwn(client.lastStats,'remote_model'),false);
  assert.equal(request.redirect,'error');
});
test('strict JSON mode still repairs schema and semantic failures',async()=>{
  const {client,calls} = harness(['{"quote":"invented"}','{"quote":"Python"}'],{structuredFormat:'strict_json'});
  const result = await client.json({system:'Extract',prompt:'Python',schema,validate:result=>{
    if(result.quote !== 'Python') throw new StructuredOutputError('Quote must be exact');
  }});
  assert.equal(result.quote,'Python');
  assert.equal(calls.length,3);
  assert.equal(Object.hasOwn(calls[1].body,'response_format'),false);
  assert.match(calls[2].body.messages.at(-1).content,/Quote must be exact/);
});
test('LM Studio rejects public endpoints and oversized input without unloading or truncating',async()=>{
  assert.throws(()=>new OllamaClient({provider:'lmstudio',model,baseUrl:'http://192.168.1.2:1234/v1'}),/loopback/);
  const {client,calls} = harness([]);
  await assert.rejects(client.json({system:'Extract',prompt:'x'.repeat(32768),schema}),{code:'NATIVE_TOKEN_COUNT_UNVERIFIED'});
  assert.equal(calls.length,0);
});
test('LM Studio rejects mismatched model and truncated output',async()=>{
  for (const envelope of [{model:'other',choices:[{message:{content:'{"quote":"Python"}'},finish_reason:'stop'}]},
    {model,choices:[{message:{content:'{"quote":"Python"}'},finish_reason:'length'}]}]) {
    const {client} = harness([]);
    client.fetch=async url => ({ok:true,json:async()=>url.endsWith('/models') ? {data:[{id:model}]} : envelope});
    await assert.rejects(client.json({system:'Extract',prompt:'Python',schema}),StructuredOutputError);
  }
});
test('LM Studio fails closed when exact configured model is absent',async()=>{
  const {client} = harness([]);
  client.fetch = async()=>({ok:true,json:async()=>({data:[{id:'different'}]})});
  assert.equal((await client.health()).ok,false);
  await assert.rejects(client.json({system:'Extract',prompt:'Python',schema}),{code:'LMSTUDIO_MODEL_UNVERIFIED'});
});
test('native complete prompt tokenization admits byte-heavy input without increasing loaded context',async()=>{
  let seen;
  const {client,calls}=harness(['{"quote":"Python"}'],{tokenCounter:async request=>{
    seen=request;
    return {inputTokens:9000,contextLength:32768};
  }});
  const prompt='x'.repeat(60000);
  await client.json({system:'Extract',prompt,schema});
  assert.equal(seen.model,model);
  assert.equal(seen.messages[1].content,prompt);
  assert.equal(calls[1].body.messages[1].content,prompt);
  assert.equal(client.lastStats.requests[0].measured_input_tokens,9000);
  assert.equal(client.lastStats.requests[0].context_tokens,32768);
  assert.equal(client.lastStats.native_context_probes,0);
});
test('native count checks actual loaded context and never transmits oversized input',async()=>{
  const {client,calls}=harness([],{tokenCounter:async()=>({inputTokens:14000,contextLength:16384})});
  await assert.rejects(client.json({system:'Extract',prompt:'x'.repeat(60000),schema}),{code:'INPUT_BUDGET_EXCEEDED'});
  assert.equal(calls.length,0);
  assert.deepEqual(client.lastStats.validation_codes,['INPUT_BUDGET_EXCEEDED','INPUT_BUDGET_EXCEEDED']);
});
test('SDK production seam disables thinking per request, preserves schema and semantic repair',async()=>{
  const requests=[];
  const {client,calls}=harness([],{sdkPredict:async request=>{
    requests.push(request);
    request.options.onPromptProcessingProgress(.5,{totalPromptTokenCount:100,processedPromptTokenCount:50});
    request.options.onFirstToken();
    request.options.onPredictionFragment({content:'private model text'});
    return {content:JSON.stringify({quote:requests.length===1 ? 'invented' : 'Python'}),modelInfo:{identifier:model},
      stats:{stopReason:'eosFound',promptTokensCount:100,predictedTokensCount:20,tokensPerSecond:15}};
  }});
  await client.json({system:'Extract',prompt:'Python',schema,validate:result=>{
    if(result.quote!=='Python') throw new StructuredOutputError('Exact quote required');
  }});
  assert.equal(calls.length,1);
  assert.equal(requests.length,2);
  assert.equal(requests[0].options.enableThinking,false);
  assert.equal(requests[0].options.maxTokens,4096);
  assert.equal(requests[0].options.contextOverflowPolicy,'stopAtLimit');
  assert.deepEqual(requests[0].options.structured,{type:'json',jsonSchema:schema});
  assert.equal(requests[1].messages[1].content,'Python');
  assert.equal(client.lastStats.transport,'lmstudio-sdk');
  assert.equal(client.lastStats.enable_thinking,false);
  assert.equal(client.lastStats.requests[0].tokens_per_second,15);
  assert.equal(client.lastStats.requests[0].stage,'completed');
  assert.equal(client.lastStats.requests[0].generated_fragments,1);
  assert.equal(client.lastStats.requests[0].prompt_processing_progress,.5);
  assert.equal(JSON.stringify(client.lastStats).includes('private model text'),false);
});
test('SDK timeout is a fixed failure and never consumes a second attempt',async()=>{
  let count=0;
  const {client}=harness([],{sdkPredict:async()=>{
    count++;
    throw new DOMException('timeout','TimeoutError');
  }});
  await assert.rejects(client.json({system:'Extract',prompt:'Python',schema}),{code:'INFERENCE_TIMEOUT'});
  assert.equal(count,1);
  assert.deepEqual(client.lastStats.validation_codes,['INFERENCE_TIMEOUT']);
});
test('hard SDK deadline cancels an unresponsive prediction and does not retry',async()=>{
  let cancelled=0,started=0;
  const {client}=harness([],{timeoutMs:1000,sdkPredict:()=>{
    started++;
    const pending=new Promise(()=>{});
    pending.cancel=()=>{cancelled++;return Promise.resolve();};
    return pending;
  }});
  const start=Date.now();
  await assert.rejects(client.json({system:'Extract',prompt:'Python',schema}),{code:'INFERENCE_TIMEOUT'});
  assert.equal(started,1);
  assert.equal(cancelled,1);
  assert.equal(client.lastStats.requests[0].stage,'timeout');
  assert.ok(Date.now()-start<3000);
});
test('SDK incomplete or mismatched results cannot pass even with valid JSON',async()=>{
  for(const failure of [{stopReason:'maxPredictedTokensReached',identifier:model},
    {stopReason:'contextLengthReached',identifier:model},{stopReason:'userStopped',identifier:model},
    {stopReason:'eosFound',identifier:'other'}]) {
    const {client}=harness([],{sdkPredict:async()=>({content:'{"quote":"Python"}',modelInfo:{identifier:failure.identifier},stats:{stopReason:failure.stopReason}})});
    await assert.rejects(client.json({system:'Extract',prompt:'Python',schema}),StructuredOutputError);
  }
});
