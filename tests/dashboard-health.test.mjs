import test from 'node:test';import assert from 'node:assert/strict';
import {createDashboard} from '../services/dashboard/server.mjs';
test('supervisor health responds without database access or dashboard login',async()=>{
 const repository={migrate:async()=>{},close:async()=>{},pool:{query(){throw Error('health must not query database');}}};
 const app=createDashboard({repository,password:'isolated-health-test',port:0});
 try{await app.start();const response=await fetch(`http://127.0.0.1:${app.server.address().port}/health`);assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,service:'dashboard'});}
 finally{await app.stop();}
});
