import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,utimes} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {acquireProfileLock} from '../services/core/profile-lock.mjs';

test('profile lock preserves initializing and live owners and rejects competing access',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'jh-profile-')); const file=path.join(directory,'owner');
 try {
  await writeFile(file,'');
  await assert.rejects(acquireProfileLock(file,{timeoutMs:20,pollMs:5}),/PROFILE_BUSY/);
  assert.equal(await readFile(file,'utf8'),'');
  await utimes(file,new Date(0),new Date(0));
  const release=await acquireProfileLock(file);
  await assert.rejects(acquireProfileLock(file,{timeoutMs:20,pollMs:5}),/PROFILE_BUSY/);
  await release();
  const next=await acquireProfileLock(file); await next();
 } finally {await rm(directory,{recursive:true,force:true});}
});

test('delayed release preserves a replacement owner',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'jh-profile-')); const file=path.join(directory,'owner');
 try {
  const release=await acquireProfileLock(file);
  await writeFile(file,`${process.pid}:replacement`); await release();
  assert.equal(await readFile(file,'utf8'),`${process.pid}:replacement`);
 } finally {await rm(directory,{recursive:true,force:true});}
});
