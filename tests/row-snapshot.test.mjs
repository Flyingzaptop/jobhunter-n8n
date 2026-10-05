import test from 'node:test';import assert from 'node:assert/strict';
import pg from 'pg';import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {backupRowSnapshot} from '../scripts/backup-row-snapshot.mjs';

test('logical snapshot preserves bigint precision and excludes concurrent writes from its consistent view',{skip:!process.env.DATABASE_URL},async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3});
 const schema='snapshot_test_'+randomUUID().replaceAll('-',''),directory=await mkdtemp(path.join(tmpdir(),'jh-snapshot-'));
 try{
  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`CREATE TABLE ${schema}.a (id bigint PRIMARY KEY);CREATE TABLE ${schema}.b (id bigint PRIMARY KEY);INSERT INTO ${schema}.a VALUES(9007199254740993);INSERT INTO ${schema}.b VALUES(1)`);
  const repository={pool:{async connect(){const client=await pool.connect();return{
   release:()=>client.release(),query:async(sql,args)=>{
    if(sql.startsWith('DECLARE')&&sql.includes('"b"'))await pool.query(`INSERT INTO ${schema}.b VALUES(2)`);
    return client.query(sql,args);
   },
  };}}};
  const receipt=await backupRowSnapshot({repository,directory,schema}),bytes=await readFile(receipt.path),text=gunzipSync(bytes).toString('utf8');
  assert.equal(receipt.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.ok(text.includes('"id":9007199254740993'));
  assert.equal(receipt.counts.a,1);assert.equal(receipt.counts.b,1);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM ${schema}.b`)).rows[0].count,2);
  assert.equal(JSON.parse(text.trim().split('\n').at(-1)).kind,'complete');
 }finally{
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();await rm(directory,{recursive:true,force:true});
 }
});
