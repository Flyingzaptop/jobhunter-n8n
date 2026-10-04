import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Repository} from '../services/core/repository.mjs';
test('PostgreSQL simultaneous service startups serialize migrations in the same schema',
 {skip:!process.env.DATABASE_URL,timeout:30000},async()=>{
 const admin=new Repository(),schema='migration_'+randomUUID().replaceAll('-','');
 await admin.pool.query(`CREATE SCHEMA ${schema}`);
 const url=new URL(process.env.DATABASE_URL);url.searchParams.set('options',`-csearch_path=${schema}`);
 const one=new Repository(url.href),two=new Repository(url.href),held=await one.pool.connect();
 try {
  await held.query("SELECT pg_advisory_lock(hashtext('jobhunter.migrations'),hashtext(current_database()||':'||current_schema()))");
  let completed=false;const pending=two.migrate().then(()=>{completed=true;});
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(completed,false);
  await held.query("SELECT pg_advisory_unlock(hashtext('jobhunter.migrations'),hashtext(current_database()||':'||current_schema()))");
  await Promise.all([pending,one.migrate()]);
  assert.ok((await two.pool.query("SELECT to_regclass('application_prose_drafts') AS t")).rows[0].t);
 } finally {
  held.release();await one.close();await two.close();
  await admin.pool.query(`DROP SCHEMA ${schema} CASCADE`);await admin.close();
 }
});
