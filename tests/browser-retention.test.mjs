import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdtemp,writeFile,utimes,access } from 'node:fs/promises';
import { pruneBrowserState } from '../services/browser-service/retention.mjs';

test('PII retention removes only expired owned browser files, preserves active sessions and unrelated files',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'jobhunter-retention-')),oldId=randomUUID(),activeId=randomUUID(),freshId=randomUUID(),old=new Date(Date.now()-10*24*3600000);
 const files=[oldId+'.json',oldId+'-1000.png',activeId+'.json',freshId+'.json','candidate_profile.yaml'];for(const file of files)await writeFile(path.join(root,file),'fixture');for(const file of files.filter(f=>f!==freshId+'.json'))await utimes(path.join(root,file),old,old);
 assert.deepEqual(await pruneBrowserState({root,activeSessionIds:new Set([activeId])}),{sessions:1,screenshots:1});
 await assert.rejects(access(path.join(root,oldId+'.json')));await access(path.join(root,activeId+'.json'));await access(path.join(root,freshId+'.json'));await access(path.join(root,'candidate_profile.yaml'));
 await assert.rejects(pruneBrowserState({root,sessionHours:-1}),/INVALID_BROWSER_RETENTION/);
});
