import test from 'node:test';import assert from 'node:assert/strict';import Ajv from 'ajv';
import {compactPromptSchema} from '../services/core/prompt-schema.mjs';
test('prompt schema factoring reduces repeated fact enums without changing permitted output or required keys',()=>{
 const ids=Array.from({length:40},(_,i)=>'verified_fact_'+i);
 const row={type:'object',properties:{fact:{type:'string',enum:ids},match:{enum:['YES','NO','UNKNOWN']}},required:['fact','match'],additionalProperties:false};
 const schema={type:'object',properties:Object.fromEntries(['a','b','c','d'].map(key=>[key,row])),required:['a','b','c','d'],additionalProperties:false};
 const original=JSON.stringify(schema),compact=compactPromptSchema(schema);
 assert.ok(JSON.stringify(compact).length<original.length/2);assert.equal(JSON.stringify(schema),original);
 const ajv=new Ajv({strict:true}),one=ajv.compile(schema),two=ajv.compile(compact);
 const good=Object.fromEntries(['a','b','c','d'].map(key=>[key,{fact:ids[0],match:'YES'}]));
 for(const value of [good,{...good,a:{fact:'invented',match:'YES'}},{...good,b:{fact:ids[0],match:'MAYBE'}},{a:good.a},{...good,extra:true}])assert.equal(two(value),one(value));
});
