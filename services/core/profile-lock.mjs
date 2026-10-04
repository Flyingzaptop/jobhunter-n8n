import {open, readFile, stat, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export async function acquireProfileLock(lockPath, {timeoutMs=60000, pollMs=250, initializationGraceMs=5000}={}) {
 const started=Date.now(), owner=`${process.pid}:${randomUUID()}`;
 for (;;) {
  try {
   const file=await open(lockPath,'wx');
   try { await file.writeFile(owner); } finally { await file.close(); }
   return async()=>{
    // A delayed close must never remove a replacement owner's lock.
    if(await readFile(lockPath,'utf8').catch(()=>null)===owner) await unlink(lockPath).catch(()=>{});
   };
  } catch(error) {
   if(error.code!=='EEXIST') throw error;
   let existing, metadata;
   try { [existing,metadata]=await Promise.all([readFile(lockPath,'utf8'),stat(lockPath)]); }
   catch(error) { if(error.code==='ENOENT') continue; throw error; }
   const pid=Number(existing.split(':')[0]); let alive=false;
   if(Number.isInteger(pid)&&pid>0) {
    try { process.kill(pid,0); alive=true; } catch(error) { alive=error.code==='EPERM'; }
   } else {
    // Exclusive creation precedes the write: an empty fresh file is owned.
    alive=Date.now()-metadata.mtimeMs<initializationGraceMs;
   }
   if(!alive && await readFile(lockPath,'utf8').catch(()=>null)===existing) {
    await unlink(lockPath).catch(()=>{}); continue;
   }
   if(Date.now()-started>=timeoutMs) throw new Error('ORDINARY_CHROME_PROFILE_BUSY');
   await new Promise(resolve=>setTimeout(resolve,pollMs));
  }
 }
}
