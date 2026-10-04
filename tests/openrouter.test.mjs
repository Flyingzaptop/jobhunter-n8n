import test from 'node:test';
import assert from 'node:assert/strict';
import {OllamaClient,StructuredOutputError,LLM_GATEWAY_VERSION} from '../services/core/llm.mjs';

const model='google/gemma-4-26b-a4b-it:free';
const secret='test-openrouter-server-secret';
const endpoint='https://openrouter.ai/api/v1';
const schema={type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false};
const request={system:'Use verified evidence.',prompt:'original facts',schema};
const catalog=(overrides={})=>({ok:true,json:async()=>({data:[{id:model,pricing:{prompt:'0',completion:'0'},
  supported_parameters:['response_format'],context_length:131072,top_provider:{max_completion_tokens:32768},...overrides}]})});
const completion=(content='{"answer":"ok"}',overrides={})=>({ok:true,json:async()=>({model:model.replace(/:free$/,''),
  choices:[{message:{content,reasoning:'private-chain-of-thought'},finish_reason:'stop'}],
  usage:{prompt_tokens:23,completion_tokens:9,total_tokens:32,cost:0},...overrides})});
const client=options=>new OllamaClient({provider:'openrouter',baseUrl:endpoint,apiKey:secret,model,strongModel:model,...options});
const seam=(reply,metadata)=>async(url,opts)=>url.endsWith('/models')?catalog(metadata):reply(url,opts);

test('OpenRouter verifies a free catalog then uses authenticated JSON-object chat with no Ollama fields or model fallback',async()=>{
  const calls=[];
  const gateway=client({fetchImpl:async(url,opts)=>{
    calls.push({url,opts});
    assert.equal(opts.redirect,'error');
    assert.equal(opts.headers.authorization,`Bearer ${secret}`);
    if(url.endsWith('/models'))return catalog();
    assert.equal(url,`${endpoint}/chat/completions`);
    const body=JSON.parse(opts.body);
    assert.equal(body.model,model);assert.equal(body.models,undefined);
    assert.equal(body.stream,false);assert.equal(body.temperature,0);assert.equal(body.max_tokens,140);
    assert.deepEqual(body.reasoning,{enabled:false,exclude:true});
    assert.deepEqual(body.response_format,{type:'json_object'});
    assert.deepEqual(body.transforms,[]);
    assert.deepEqual(body.provider,{max_price:{prompt:0,completion:0}});
    for(const key of ['think','format','options','keep_alive'])assert.equal(body[key],undefined);
    assert.deepEqual(JSON.parse(body.messages[0].content.split('JSON Schema:\n')[1]),schema);
    return completion();
  }});
  assert.deepEqual(await gateway.json({...request,numPredict:140}),{answer:'ok'});
  assert.deepEqual(calls.map(x=>x.url),[`${endpoint}/models`,`${endpoint}/chat/completions`]);
  assert.equal(gateway.lastStats.provider,'openrouter');assert.equal(gateway.lastStats.model,model);
  assert.equal(gateway.lastStats.remote_model,model.replace(/:free$/,''));
  assert.deepEqual(gateway.lastStats.requests[0].usage,{prompt_tokens:23,completion_tokens:9,total_tokens:32});
  assert.equal(gateway.lastStats.gateway_version,LLM_GATEWAY_VERSION);
  for(const value of [secret,'private-chain-of-thought',request.prompt]){
    assert.equal(JSON.stringify(gateway).includes(value),false);
    assert.equal(JSON.stringify(gateway.lastStats).includes(value),false);
  }
});

test('OpenRouter rejects a substituted endpoint, credentials and nonfree model before any network',()=>{
  for(const baseUrl of ['http://openrouter.ai/api/v1','https://openrouter.ai.evil.invalid/api/v1',
    'https://openrouter.ai','https://openrouter.ai/api/v1/chat','https://openrouter.ai/api/v1?key=test',
    'https://openrouter.ai/api/v1#fragment','https://user:pass@openrouter.ai/api/v1',
    'http://127.0.0.1:11434'])assert.throws(()=>client({baseUrl}),/exact|endpoint/);
  for(const apiKey of ['',null,'key\nx-header:private'])assert.throws(()=>client({apiKey}),/server-only/);
  for(const candidate of [model.replace(':free',''),'openrouter/auto','openrouter/free','gemma4:cloud',`${model},paid/model`]){
    assert.throws(()=>client({model:candidate}),/:free|cloud model name/);
    assert.throws(()=>client({strongModel:candidate}),/:free|cloud model name/);
  }
  assert.equal(client({baseUrl:`${endpoint}/`}).baseUrl,endpoint);
});

test('free pricing and JSON-object capability must be verified before inference; paid catalog entries cannot become alternatives',async()=>{
  for(const metadata of [{id:'paid/model',pricing:{prompt:'1',completion:'1'}},
    {pricing:{prompt:'0.00001',completion:'0'}},{pricing:{prompt:'0',completion:'1'}},
    {pricing:{prompt:null,completion:'0'}},{pricing:{prompt:'',completion:'0'}},{pricing:{}},
    {supported_parameters:['structured_outputs']}, {supported_parameters:undefined}]){
    const endpoints=[];
    const gateway=client({fetchImpl:async(url)=>{endpoints.push(url);return catalog(metadata);}});
    assert.deepEqual((await gateway.health()).available_models,[]);
    await assert.rejects(gateway.json(request),error=>error.code==='OPENROUTER_FREE_MODEL_UNVERIFIED');
    assert.equal(endpoints.some(url=>url.endsWith('/chat/completions')),false);
  }
  const gateway=client({fetchImpl:async()=>({ok:true,json:async()=>({data:[
    {id:'paid/model',pricing:{prompt:'1',completion:'1'}},
    {id:model,pricing:{prompt:'0',completion:0},supported_parameters:['response_format']} ]})})});
  assert.deepEqual(await gateway.health(),{ok:true,provider:'openrouter',fast_model:model,strong_model:model,available_models:[model]});
});

test('clone retains private authentication/provider while requiring new catalog proof and free models',async()=>{
  const endpoints=[];
  const gateway=client({fetchImpl:async(url,opts)=>{
    endpoints.push(url);assert.equal(opts.headers.authorization,`Bearer ${secret}`);
    return url.endsWith('/models')?catalog():completion();
  }});
  await gateway.health();const clone=gateway.withModels({strongModel:model});
  assert.equal(clone.provider,'openrouter');assert.equal(clone.fetch,gateway.fetch);
  assert.throws(()=>clone.withModels({model:'paid/model'}),/:free/);
  assert.throws(()=>{clone.model='paid/model';},TypeError);
  await clone.json({...request,strong:true});
  assert.deepEqual(endpoints,[`${endpoint}/models`,`${endpoint}/models`,`${endpoint}/chat/completions`]);
  assert.equal(JSON.stringify(clone).includes(secret),false);
});

test('OpenRouter repairs JSON/schema/semantic failures once, preserves original facts and never replays raw output',async()=>{
  for(const first of ['not-json','{"answer":"ok","invented":true}','{"answer":"unsupported-raw-output"}']){
    const bodies=[];
    const gateway=client({fetchImpl:seam(async(_url,opts)=>{
      bodies.push(JSON.parse(opts.body));return completion(bodies.length===1?first:undefined);
    })});
    assert.deepEqual(await gateway.json({...request,validate:value=>{
      if(value.answer!=='ok')throw new StructuredOutputError(`unsupported fact F22; ${secret}; Bearer another-secret`);
    }}),{answer:'ok'});
    assert.equal(bodies.length,2);assert.equal(bodies[1].messages[1].content,request.prompt);
    for(const value of [secret,'another-secret','unsupported-raw-output'])assert.equal(JSON.stringify(bodies[1]).includes(value),false);
    assert.equal(gateway.lastStats.semantic_attempts,2);
  }
  let calls=0;
  const gateway=client({fetchImpl:seam(async()=>{calls++;return completion('{"wrong":"shape"}');})});
  await assert.rejects(gateway.json(request),error=>error.code==='SCHEMA_VALIDATION_FAILED');assert.equal(calls,2);
});

test('OpenRouter minimizes known contact containers while keeping all qualifications and exact source quotes',async()=>{
  const prompt={candidate:{legal_name:'Private Person',email:'private@example.invalid',phone:'private-phone',
    work_authorization:'EU',identity:{full_name:'Private Name',country:'PL'}},
    onboarding:{email:'private@example.invalid',preferred_roles:['engineer']},
    candidate_facts:[{id:'F22',name:'Degree name',source_quote:'Exact quote CAD and FEA',status:'IN_PROGRESS'}],
    source_fragments_untrusted_data:[{id:1,text:'Need CAD; exact punctuation.'}]};
  const gateway=client({fetchImpl:seam(async(_url,opts)=>{
    const transmitted=JSON.parse(JSON.parse(opts.body).messages[1].content);
    assert.deepEqual(transmitted.candidate,{work_authorization:'EU',identity:{country:'PL'}});
    assert.deepEqual(transmitted.onboarding,{preferred_roles:['engineer']});
    assert.deepEqual(transmitted.candidate_facts,prompt.candidate_facts);
    assert.deepEqual(transmitted.source_fragments_untrusted_data,prompt.source_fragments_untrusted_data);
    return completion();
  })});await gateway.json({...request,prompt:JSON.stringify(prompt)});
});

test('HTTP, error-envelope and network failures expose fixed codes, including rate limits, without any fallback',async()=>{
  for(const [reply,code] of [[()=>({ok:false,status:429}),'HTTP_429'],[()=>({ok:false,status:401}),'HTTP_401'],
    [()=>completion(undefined,{error:{code:429,message:secret}}),'HTTP_429'],
    [()=>{throw Object.assign(new Error(secret),{name:secret});},'REQUEST_FAILED']]){
    const endpoints=[];
    const gateway=client({fetchImpl:async(url)=>{endpoints.push(url);return url.endsWith('/models')?catalog():reply();}});
    await assert.rejects(gateway.json(request),error=>{
      assert.equal(error.code,code);assert.equal(error.message.includes(secret),false);return true;
    });
    assert.deepEqual(endpoints,[`${endpoint}/models`,`${endpoint}/chat/completions`,
      ...(code==='REQUEST_FAILED'?[`${endpoint}/chat/completions`]:[])]);
    assert.equal(JSON.stringify(gateway.lastStats).includes(secret),false);
  }
  const gateway=client({fetchImpl:async()=>({ok:false,status:429})});
  await assert.rejects(gateway.health(),error=>error.code==='HTTP_429');
  await assert.rejects(gateway.json(request),error=>error.code==='HTTP_429');
});

test('quota and authorization failures defer after one request; numeric Retry-After is safe queue metadata only',async()=>{
  for(const status of [429,401,402,403]){
    let chats=0;
    const gateway=client({fetchImpl:seam(async()=>{
      chats++;return {ok:false,status,headers:{get:()=>status===429?'60.5':secret},
        json:async()=>{throw new Error('Error bodies must not be read');}};
    })});
    await assert.rejects(gateway.json(request),error=>{
      assert.equal(error.code,`HTTP_${status}`);assert.match(error.message,/after 1 attempt/);
      assert.deepEqual(error.metadata,status===429?{retry_after_seconds:61}:undefined);
      assert.equal(JSON.stringify(error).includes(secret),false);return true;
    });
    assert.equal(chats,1);assert.equal(gateway.lastStats.semantic_attempts,1);
    assert.equal(gateway.lastStats.retry_after_seconds,status===429?61:undefined);
  }
  for(const retry_after_seconds of [0,120,secret,-1,Infinity,604801,null]){
    let chats=0;const gateway=client({fetchImpl:seam(async()=>{
      chats++;return completion(undefined,{error:{code:429,message:secret,
        metadata:{retry_after_seconds,raw:secret,provider_name:secret}}});
    })});
    await assert.rejects(gateway.json(request),error=>{
      assert.equal(error.code,'HTTP_429');
      assert.deepEqual(error.metadata,[0,120].includes(retry_after_seconds)?{retry_after_seconds}:undefined);
      assert.equal(JSON.stringify(error).includes(secret),false);return true;
    });assert.equal(chats,1);assert.equal(JSON.stringify(gateway.lastStats).includes(secret),false);
  }
  let catalogs=0;
  const gateway=client({fetchImpl:async()=>{catalogs++;return {ok:false,status:429,headers:{get:()=> '180'}};}});
  await assert.rejects(gateway.json(request),error=>error.code==='HTTP_429'&&error.metadata.retry_after_seconds===180);
  assert.equal(catalogs,1);assert.equal(gateway.lastStats.requests.length,0);
});

test('health errors redact network bodies and fail closed on malformed catalogs',async()=>{
  for(const fetchImpl of [async()=>{throw new Error(secret);},async()=>({ok:false,status:secret}),
    async()=>({ok:true,json:async()=>{throw new Error(secret);}}),async()=>({ok:true,json:async()=>({models:[]})})]){
    const gateway=client({fetchImpl});
    await assert.rejects(gateway.health(),error=>{assert.equal(error.message.includes(secret),false);return true;});
  }
});

test('truncated, wrong-model, malformed and nonfree-cost completion envelopes fail even when content parses',async()=>{
  for(const [overrides,code] of [
    [{choices:[{message:{content:'{"answer":"ok"}'},finish_reason:'length'}]},'OUTPUT_BUDGET_EXHAUSTED'],
    [{choices:[{message:{content:null},finish_reason:'length'}]},'OUTPUT_BUDGET_EXHAUSTED'],
    [{choices:[]},'INVALID_RESPONSE'],[{choices:[{message:{content:{answer:'ok'}},finish_reason:'stop'}]},'INVALID_RESPONSE'],
    [{choices:[{message:{content:'{"answer":"ok"}'},finish_reason:'content_filter'}]},'INVALID_RESPONSE'],
    [{model:'paid/model'},'INVALID_RESPONSE'],[{model:secret},'INVALID_RESPONSE'],
    [{usage:{cost:0.001}},'OPENROUTER_NONFREE_USAGE']]){
    let calls=0;const gateway=client({fetchImpl:seam(async()=>{calls++;return completion(undefined,overrides);})});
    await assert.rejects(gateway.json(request),error=>error.code===code);assert.equal(calls,code==='OPENROUTER_NONFREE_USAGE'?1:2);
    assert.equal(JSON.stringify(gateway.lastStats).includes(secret),false);
  }
});

test('only numeric token counters enter stats and reasoning never enters validation or diagnostics',async()=>{
  const gateway=client({fetchImpl:seam(async()=>completion(undefined,{usage:{prompt_tokens:secret,
    completion_tokens:-2,total_tokens:Infinity,details:{reasoning:secret}},reasoning:secret}))});
  await gateway.json(request);
  assert.deepEqual(gateway.lastStats.requests[0].usage,{prompt_tokens:null,completion_tokens:null,total_tokens:null});
  assert.equal(JSON.stringify(gateway.lastStats).includes(secret),false);
});

test('whole input/output is bounded without transmitting or truncating excessive facts',async()=>{
  let calls=0;const gateway=client({fetchImpl:seam(async()=>{calls++;return completion();})});
  await assert.rejects(gateway.json({...request,prompt:'事实'.repeat(12000)}),/INPUT_BUDGET_EXCEEDED/);
  await assert.rejects(gateway.json({...request,numPredict:32769}),/Invalid cloud context/);
  assert.equal(calls,0);
  const limited=client({fetchImpl:seam(async()=>{calls++;return completion();},{context_length:2000})});
  await assert.rejects(limited.json(request),error=>error.code==='INPUT_BUDGET_EXCEEDED');assert.equal(calls,0);
  const outputLimited=client({fetchImpl:seam(async()=>{calls++;return completion();},{top_provider:{max_completion_tokens:50}})});
  await assert.rejects(outputLimited.json({...request,numPredict:51}),error=>error.code==='INPUT_BUDGET_EXCEEDED');assert.equal(calls,0);
  const excessive=client({fetchImpl:seam(async()=>completion('x'.repeat(1048577)))});
  await assert.rejects(excessive.json(request),error=>error.code==='OUTPUT_SIZE_EXCEEDED');
});

test('a health refresh revokes earlier proof when free pricing changes',async()=>{
  let paid=false;let chats=0;
  const gateway=client({fetchImpl:async(url)=>{
    if(url.endsWith('/models'))return catalog(paid?{pricing:{prompt:'1',completion:'1'}}:{});
    chats++;return completion();
  }});
  await gateway.json(request);paid=true;assert.equal((await gateway.health()).ok,false);
  await assert.rejects(gateway.json(request),error=>error.code==='OPENROUTER_FREE_MODEL_UNVERIFIED');
  assert.equal(chats,1);
});
