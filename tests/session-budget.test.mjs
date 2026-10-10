import test from 'node:test';import assert from 'node:assert/strict';
import {SessionBudget} from '../services/browser-service/session-budget.mjs';
test('concurrent browser creation respects the cap, including pending contexts',async()=>{
 const sessions=new Map(),budget=new SessionBudget({sessions,max:2,close:async()=>{}});
 const release=await budget.reserve(),second=await budget.reserve();
 await assert.rejects(budget.reserve(),/CAPACITY/);release();release();await budget.reserve();
 await assert.rejects(budget.reserve(),/CAPACITY/);second();
});
test('idle pages are closed while active operations and progressing model leases survive',async()=>{
 const sessions=new Map([['idle',{id:'idle',lastUsedAt:0}],['operation',{id:'operation',lastUsedAt:0,activeCalls:1}],['model',{id:'model',lastUsedAt:0,leaseUntil:5000}],['submit',{id:'submit',lastUsedAt:0,submitActive:true}]]);
 const closed=[];let now=3000;const budget=new SessionBudget({sessions,idleMs:1000,now:()=>now,close:async s=>{closed.push(s.id);sessions.delete(s.id);}});
 await budget.sweep();assert.deepEqual(closed,['idle']);now=6000;await budget.sweep();assert.deepEqual(closed,['idle','model']);
});
