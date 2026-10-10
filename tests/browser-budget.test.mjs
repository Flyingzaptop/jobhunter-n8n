import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createBrowserService,browserConfig} from '../services/browser-service/server.mjs';
test('real Chromium: capped contexts, failed navigation cleanup, saved idle eviction and model lease',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'jh-browser-budget-'));
 const service=await createBrowserService({...browserConfig({BROWSER_SERVICE_TOKEN:'fixture'}),port:0,stateRoot:root,artifactRoot:root,maxSessions:2,sessionIdleMs:1000});
 await service.listen();t.after(()=>service.close());const base=`http://127.0.0.1:${service.server.address().port}`;
 const call=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify(body??{})});return {status:r.status,...await r.json()};};
 for(let i=0;i<3;i++){assert.equal((await call('/sessions',{application_id:'fixture',url:'file:///invalid'})).status,400);assert.equal(service.sessions.size,0);}
 const created=await Promise.all(Array.from({length:8},()=>call('/sessions',{application_id:'fixture'})));
 assert.equal(created.filter(x=>x.status===201).length,2);assert.equal(service.sessions.size,2);
 const [first,second]=[...service.sessions.values()];await call(`/sessions/${first.id}/lease`);
 first.lastUsedAt=0;second.lastUsedAt=0;await service.sweepIdle();assert.equal(service.sessions.size,1);assert.ok(service.sessions.has(first.id));
 assert.equal(JSON.parse(await readFile(path.join(root,second.id+'.json'),'utf8')).application_id,'fixture');
 await call(`/sessions/${first.id}/lease`,{release:true});first.lastUsedAt=0;await service.sweepIdle();assert.equal(service.sessions.size,0);
});
