import test from 'node:test';
import assert from 'node:assert/strict';
import {runObserved,operationContext} from '../services/core/observability.mjs';
test('concurrent observed operations retain their own event correlation and blocked work is not success',async()=>{
 const writes=[],events=[];
 const repo={pool:{query:async(sql,values)=>{writes.push({sql,values});return {rows:[]};}},event:async(...args)=>events.push({args,context:operationContext.getStore()})};
 const [blocked,complete]=await Promise.all([
  runObserved(repo,4,{},async()=>{await new Promise(resolve=>setTimeout(resolve,15));return {generated:1,status:'BLOCKED_IDENTITY'};}),
  runObserved(repo,3,{},async()=>({attempted:2,analyzed:2,results:[{decision:'REVIEW'},{decision:'REJECT'}]})),
 ]);
 assert.notEqual(blocked.operation_run_id,complete.operation_run_id);
 for(const event of events)assert.equal(event.args[1],event.context.run_id);
 const terminal=writes.filter(w=>w.sql.includes('UPDATE operation_runs'));
 const b=terminal.find(w=>w.values[0]===blocked.operation_run_id);
 assert.equal(b.values[1],'BLOCKED');assert.equal(b.values[3],0);
 const success=terminal.find(w=>w.values[0]===complete.operation_run_id);
 assert.equal(success.values[1],'SUCCEEDED');assert.equal(success.values[3],2);
 assert.equal(operationContext.getStore(),undefined);
});
