import test from 'node:test';
import assert from 'node:assert/strict';
import {OllamaClient,StructuredOutputError,LLM_GATEWAY_VERSION} from '../services/core/llm.mjs';

const schema={type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false};
const secret='test-server-key-never-log';
const envelope=(content='{"answer":"ok"}',extra={})=>({ok:true,json:async()=>({message:{content},...extra})});
const direct=options=>new OllamaClient({provider:'cloud',baseUrl:'https://ollama.com',apiKey:secret,
  model:'gemma4:31b',strongModel:'gemma4:31b',...options});
const request={system:'Use verified evidence.',prompt:'original facts',schema};

test('direct cloud auth covers chat and health, rejects redirects, embeds schema without unsupported local fields',async()=>{
  const calls=[];
  const client=direct({fetchImpl:async(url,options)=>{
    calls.push({url,options});
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.authorization,`Bearer ${secret}`);
    if(url.endsWith('/api/tags'))return {ok:true,json:async()=>({models:[{name:'gemma4:31b'}]})};
    const body=JSON.parse(options.body);
    assert.equal(body.model,'gemma4:31b');
    assert.equal(body.stream,false);
    assert.equal(body.format,undefined);
    assert.equal(body.keep_alive,undefined);
    assert.equal(body.options.num_ctx,undefined);
    assert.equal(body.options.temperature,0);
    assert.deepEqual(JSON.parse(body.messages[0].content.split('JSON Schema:\n')[1]),schema);
    return envelope();
  }});
  assert.deepEqual(await client.json({...request,prompt:'all facts '.repeat(4500),numPredict:100}),{answer:'ok'});
  assert.equal((await client.health()).ok,true);
  assert.equal(calls.length,2);
  assert.equal(client.lastStats.native_context_probes,0);
  assert.equal(client.lastStats.provider,'cloud');
  assert.equal(JSON.stringify(client).includes(secret),false);
  assert.equal(JSON.stringify(client.lastStats).includes(secret),false);
});

test('cloud wrong endpoint, credentials, query, path, protocol and missing key fail before network',()=>{
  for(const baseUrl of ['http://ollama.com','https://ollama.com.evil.invalid','https://evil.invalid',
    'https://ollama.com/api','https://ollama.com/?key=value','https://ollama.com/#fragment',
    'https://user:pass@ollama.com','http://127.0.0.1:11434'])assert.throws(()=>direct({baseUrl}));
  assert.throws(()=>direct({apiKey:''}),/server-only OLLAMA_API_KEY/);
  assert.throws(()=>direct({apiKey:'key\r\nx-header:value'}),/server-only/);
  assert.throws(()=>direct({provider:'unknown'}),/Invalid Ollama provider/);
  assert.throws(()=>new OllamaClient({provider:'local',baseUrl:'https://ollama.com'}),/local\/private/);
});

test('cloud relay is loopback only and can never use an unsuffixed local model or Bearer',async()=>{
  const options={provider:'cloud-relay',baseUrl:'http://127.0.0.1:11434',model:'gemma4:cloud',strongModel:'gemma4:cloud',apiKey:secret};
  for(const baseUrl of ['http://192.168.1.2:11434','https://ollama.com','http://host.docker.internal:11434',
    'http://127.0.0.1:11434/path'])assert.throws(()=>new OllamaClient({...options,baseUrl}),/loopback/);
  for(const model of ['gemma4:31b','qwen3.5:4b','gemma4:cloud-local']){
    assert.throws(()=>new OllamaClient({...options,model}),/cloud-suffixed/);
    assert.throws(()=>new OllamaClient({...options,strongModel:model}),/cloud-suffixed/);
  }
  const client=new OllamaClient({...options,fetchImpl:async(url,opts)=>{
    assert.equal(opts.headers.authorization,undefined);
    if (url.endsWith('/api/tags')) return {ok:true,json:async()=>({models:[{name:'gemma4:cloud',remote_model:'gemma4:31b',remote_host:'https://ollama.com'}]})};
    assert.equal(url,'http://127.0.0.1:11434/api/chat');
    const body=JSON.parse(opts.body);assert.equal(body.model,'gemma4:cloud');assert.equal(body.format,undefined);
    return envelope();
  }});
  assert.deepEqual(await client.json(request),{answer:'ok'});
  assert.throws(()=>{client.model='gemma4:31b';},TypeError);
  assert.throws(()=>client.withModels({strongModel:'gemma4:31b'}),/cloud-suffixed/);
  assert.equal(new OllamaClient({...options,model:'gemma4:31b-cloud'}).model,'gemma4:31b-cloud');
});

test('cloud relay refuses cloud-suffixed aliases without verified Ollama remote metadata and caches successful proof',async()=>{
  for(const remote of [{},{remote_model:'gemma4:31b',remote_host:'https://evil.invalid'},
    {remote_model:'gemma4:31b',remote_host:'http://ollama.com'}, {remote_host:'https://ollama.com'}]){
    let chats=0;
    const client=new OllamaClient({provider:'cloud-relay',baseUrl:'http://127.0.0.1:11434',model:'gemma4:cloud',strongModel:'gemma4:cloud',
      fetchImpl:async(url)=>{if(url.endsWith('/api/chat')){chats++;return envelope();}
        return {ok:true,json:async()=>({models:[{name:'gemma4:cloud',...remote}]})};}});
    assert.equal((await client.health()).ok,false);
    await assert.rejects(client.json(request),/CLOUD_RELAY_UNVERIFIED/);assert.equal(chats,0);
  }
  let tags=0;let chats=0;
  const client=new OllamaClient({provider:'cloud-relay',baseUrl:'http://127.0.0.1:11434',model:'gemma4:cloud',strongModel:'gemma4:cloud',
    fetchImpl:async(url)=>{if(url.endsWith('/api/chat')){chats++;return envelope();}tags++;
      return {ok:true,json:async()=>({models:[{name:'gemma4:cloud',remote_model:'gemma4:31b',remote_host:'https://ollama.com'}]})};}});
  await client.json(request);await client.json(request);assert.equal(tags,1);assert.equal(chats,2);
  assert.equal(client.lastStats.remote_model,'gemma4:31b');
});

test('cloud accepts only a complete JSON fence; prose extraction and oversize envelopes fail closed',async()=>{
  for(const content of ['```json\n{"answer":"ok"}\n```','  ```\r\n{"answer":"ok"}\r\n```  ']){
    const client=direct({fetchImpl:async()=>envelope(content)});
    assert.deepEqual(await client.json(request),{answer:'ok'});
  }
  for(const content of ['Here is JSON:\n```json\n{"answer":"ok"}\n```',
    '```json\n{"answer":"ok"}\n```\nExplanation', '```javascript\n{"answer":"ok"}\n```']){
    let calls=0;const client=direct({fetchImpl:async()=>{calls++;return envelope(content);}});
    await assert.rejects(client.json(request),/JSON_PARSE_ERROR/);assert.equal(calls,2);
  }
  const client=direct({fetchImpl:async()=>envelope('a'.repeat(1048577))});
  await assert.rejects(client.json(request),error=>error.code==='OUTPUT_SIZE_EXCEEDED');
});

test('cloud schema, parsing and semantic failures retry exactly once with original facts and fail closed',async()=>{
  for(const first of ['{bad','{"answer":"ok","invented":true}','{"answer":"unsupported"}']){
    const bodies=[];let validations=0;
    const client=direct({fetchImpl:async(_url,opts)=>{
      bodies.push(JSON.parse(opts.body));return envelope(bodies.length===1?first:undefined);
    }});
    assert.deepEqual(await client.json({...request,validate:value=>{
      validations++;if(value.answer!=='ok')throw new StructuredOutputError(`unsupported private ${secret}`);
    }}),{answer:'ok'});
    assert.equal(bodies.length,2);
    assert.equal(bodies[1].messages[1].content,request.prompt);
    assert.equal(JSON.stringify(bodies[1]).includes(secret),false);
    assert.equal(validations,first.includes('unsupported')?2:1);
  }
  for(const content of ['{bad','{"wrong":"shape"}','{"answer":"unsupported"}']){
    let calls=0;
    const client=direct({fetchImpl:async()=>{calls++;return envelope(content);}});
    await assert.rejects(client.json({...request,validate:()=>{throw new StructuredOutputError(`private ${secret}`);}}),error=>{
      assert.match(error.message,/after 2 attempts/);assert.equal(error.message.includes(secret),false);return true;
    });assert.equal(calls,2);
  }
});

test('cloud repair includes actionable schema and semantic diagnostics while public errors/stats contain codes only',async()=>{
  const missingSchema={type:'object',properties:{explicit_requirements:{type:'object',properties:{42:{type:'string'}},required:['42'],additionalProperties:false}},
    required:['explicit_requirements'],additionalProperties:false};
  const bodies=[];
  const client=direct({fetchImpl:async(_url,opts)=>{
    bodies.push(JSON.parse(opts.body));return envelope(bodies.length===1?'{}':'{"explicit_requirements":{"42":"ok"}}');
  }});
  assert.deepEqual(await client.json({...request,schema:missingSchema}),{explicit_requirements:{42:'ok'}});
  assert.match(bodies[1].messages[2].content,/required missing field explicit_requirements/);
  assert.deepEqual(client.lastStats.validation_codes,['SCHEMA_VALIDATION_FAILED']);
  assert.equal(client.lastStats.gateway_version,LLM_GATEWAY_VERSION);

  const semanticBodies=[];
  const semantic=direct({fetchImpl:async(_url,opts)=>{semanticBodies.push(JSON.parse(opts.body));return envelope();}});
  const diagnostic='mandatory requirement omitted: exact source CAD and FEA; unsupported provenance fact_id=F22';
  await assert.rejects(semantic.json({...request,prompt:JSON.stringify({candidate:{legal_name:'Private Person',email:'private@example.invalid'},candidate_facts:[{id:'F22'}]}),
    validate:()=>{throw new StructuredOutputError(`${diagnostic}; ${secret}; Bearer another-token; Private Person private@example.invalid`);}}),error=>{
      assert.equal(error.code,'SEMANTIC_VALIDATION_FAILED');
      assert.equal(error.message.includes(diagnostic),false);assert.equal(error.message.includes(secret),false);return true;
    });
  const repair=semanticBodies[1].messages[2].content;
  assert.ok(repair.includes(diagnostic));
  for(const forbidden of [secret,'another-token','Private Person','private@example.invalid'])assert.equal(repair.includes(forbidden),false);
  assert.deepEqual(semantic.lastStats.validation_codes,['SEMANTIC_VALIDATION_FAILED','SEMANTIC_VALIDATION_FAILED']);
  assert.equal(JSON.stringify(semantic.lastStats).includes(diagnostic),false);
  assert.equal(JSON.stringify(semantic.lastStats).includes(secret),false);
});

test('cloud semantic repair diagnostics stay bounded and never replay the model output',async()=>{
  const bodies=[];
  const client=direct({fetchImpl:async(_url,opts)=>{bodies.push(JSON.parse(opts.body));return envelope('{"answer":"raw-output-private-marker"}');}});
  await assert.rejects(client.json({...request,validate:()=>{throw new StructuredOutputError('Known fact problem. '.repeat(2000));}}),/SEMANTIC_VALIDATION_FAILED/);
  const repair=bodies[1].messages[2].content;
  assert.match(repair,/Known fact problem/);assert.ok(repair.length<2000);
  assert.equal(repair.includes('raw-output-private-marker'),false);
  assert.equal(JSON.stringify(client.lastStats).includes('Known fact problem'),false);
});

test('cloud network and HTTP errors disclose only codes and cannot fall back',async()=>{
  for(const failure of [()=>{throw Object.assign(new Error(secret),{name:secret});},()=>({ok:false,status:401})]){
    const endpoints=[];
    const client=direct({fetchImpl:async(url)=>{endpoints.push(url);return failure();}});
    await assert.rejects(client.json(request),error=>{
      assert.match(error.message,/REQUEST_FAILED|HTTP_401/);assert.equal(error.message.includes(secret),false);return true;
    });
    assert.deepEqual(endpoints,['https://ollama.com/api/chat','https://ollama.com/api/chat']);
    await assert.rejects(client.health(),error=>{assert.equal(error.message.includes(secret),false);return true;});
  }
});

test('cloud bounds whole input including schema and repair without truncating or transmitting oversize facts',async()=>{
  let calls=0;
  const client=direct({fetchImpl:async()=>{calls++;return envelope();}});
  await assert.rejects(client.json({...request,prompt:'事实'.repeat(12000)}),/INPUT_BUDGET_EXCEEDED/);
  assert.equal(calls,0);
  await assert.rejects(client.json({...request,numPredict:-10}),/Invalid cloud context\/output budget/);
  assert.equal(calls,0);
  await assert.rejects(client.json({...request,schema:{...schema,description:'e'.repeat(70000)}}),/INPUT_BUDGET_EXCEEDED/);
  assert.equal(calls,0);
});

test('cloud excludes known candidate contacts but retains source quotes and all qualification facts',async()=>{
  const data={candidate:{name:'Private Person',legal_name:'Private Legal',email:'private@example.invalid',phone:'private-phone',
    work_authorization:'EU',identity:{full_name:'Private Name',country:'PL'}},onboarding:{legal_name:'Private Legal',email:'private@example.invalid',
      preferred_roles:['engineer']},candidate_facts:[{id:'degree',name:'Degree name',source_quote:'Exact quote — CAD, FEA.',status:'IN_PROGRESS'}],
    source_fragments_untrusted_data:[{id:1,text:'Need CAD with exact quote.'}]};
  const client=direct({fetchImpl:async(_url,opts)=>{
    const prompt=JSON.parse(JSON.parse(opts.body).messages[1].content);
    assert.deepEqual(prompt.candidate,{work_authorization:'EU',identity:{country:'PL'}});
    assert.deepEqual(prompt.onboarding,{preferred_roles:['engineer']});
    assert.deepEqual(prompt.candidate_facts,data.candidate_facts);
    assert.deepEqual(prompt.source_fragments_untrusted_data,data.source_fragments_untrusted_data);
    return envelope();
  }});await client.json({...request,prompt:JSON.stringify(data)});
});

test('cloud clone preserves provider, auth, model choice and fetch seam',async()=>{
  const client=direct({fetchImpl:async(_url,opts)=>{
    assert.equal(opts.headers.authorization,`Bearer ${secret}`);
    assert.equal(JSON.parse(opts.body).model,'gemma4:31b');return envelope();
  }});
  const clone=client.withModels({strongModel:'gemma4:31b'});
  assert.equal(clone.provider,'cloud');assert.equal(clone.fetch,client.fetch);
  await clone.json({...request,strong:true});
});

test('cloud output exhaustion cannot pass validation even when a partial response parses',async()=>{
  let calls=0;
  const client=direct({fetchImpl:async()=>{calls++;return envelope(undefined,{done_reason:'length',eval_count:100});}});
  await assert.rejects(client.json(request),/OUTPUT_BUDGET_EXHAUSTED/);assert.equal(calls,2);
});
