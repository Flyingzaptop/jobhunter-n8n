import test from 'node:test';
import assert from 'node:assert/strict';
import {runSourcePool} from '../services/core/parallel-discovery.mjs';
test('sources run concurrently while the same host is serialized and failures do not stop other sources',async()=>{
 let active=0,maximum=0;const hosts=new Set(),finished=[];
 const sources=[{name:'a',url:'https://one.invalid/a'},{name:'b',url:'https://two.invalid/b'},{name:'c',url:'https://one.invalid/c'}];
 const result=await runSourcePool(sources,async s=>{const host=new URL(s.url).hostname;assert.equal(hosts.has(host),false);hosts.add(host);maximum=Math.max(maximum,++active);await new Promise(r=>setTimeout(r,35));hosts.delete(host);active--;finished.push(s.name);if(s.name==='b')throw new Error('HTTP_ACCESS_BLOCKED');return s.name;});
 assert.equal(maximum,2);assert.equal(finished.length,3);assert.equal(result.filter(r=>r.status==='FAILED').length,1);
});
