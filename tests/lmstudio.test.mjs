import test from 'node:test';
import assert from 'node:assert/strict';
import {OllamaClient,StructuredOutputError} from '../services/core/llm.mjs';

const model = 'gemma4-26b-a4b-qat-uncensored-hauhaucs-balanced-mtp';
const schema = {type:'object',properties:{quote:{type:'string'}},required:['quote'],additionalProperties:false};
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
