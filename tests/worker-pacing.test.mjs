import test from 'node:test';import assert from 'node:assert/strict';
import {lanePollDelay,SharedSnapshot} from '../services/core/worker-pacing.mjs';
test('idle and failed model polling backs off while successful work can continue immediately',()=>{
 for(const state of ['RETRY','PAUSED','WAITING','EMPTY_QUEUE'])assert.ok(lanePollDelay('model',state)>=30000);
 assert.equal(lanePollDelay('model','IDLE'),250);
});
test('22 concurrent lanes share a single market query; failed cache can recover',async()=>{
 const cache=new SharedSnapshot();let calls=0,finish;
 const load=()=>{calls++;return new Promise(resolve=>finish=resolve);};
 const pending=Array.from({length:22},()=>cache.get('profile',load));await Promise.resolve();assert.equal(calls,1);finish('result');assert.deepEqual(await Promise.all(pending),Array(22).fill('result'));await cache.get('profile',load);assert.equal(calls,1);
 await assert.rejects(cache.get('new',()=>Promise.reject(Error('failed'))));assert.equal(await cache.get('new',()=>42),42);
});
