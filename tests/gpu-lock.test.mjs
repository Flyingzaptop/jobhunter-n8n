import test from 'node:test';
import assert from 'node:assert/strict';
import {withExclusiveLocalGpu} from '../services/core/gpu-lock.mjs';
test('occupied local GPU prevents any model operation and releases the database lease',async()=>{
 let called=false,released=0;const repo={pool:{connect:async()=>({query:async()=>({rows:[{locked:false}]}),release:()=>released++})}};
 assert.deepEqual(await withExclusiveLocalGpu(repo,async()=>{called=true;}),{blocked_reason:'LOCAL_GPU_BUSY',processed:0});assert.equal(called,false);assert.equal(released,1);
});
test('a model failure releases its exclusive GPU lock so later jobs can proceed',async()=>{
 let unlocked=0,released=0;const repo={pool:{connect:async()=>({query:async sql=>{if(sql.includes('pg_advisory_unlock'))unlocked++;return {rows:[{locked:true}]};},release:()=>released++})}};
 await assert.rejects(withExclusiveLocalGpu(repo,async()=>{throw new Error('Real model timed out');}),/timed out/);
 assert.equal(unlocked,1);assert.equal(released,1);
 assert.equal(await withExclusiveLocalGpu(repo,async()=>42),42);assert.equal(unlocked,2);assert.equal(released,2);
});
