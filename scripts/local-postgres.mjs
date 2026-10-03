import EmbeddedPostgres from 'embedded-postgres';
import {existsSync} from 'node:fs';
const pg=new EmbeddedPostgres({databaseDir:'data/local-postgres',user:process.env.POSTGRES_USER??'jobhunter',password:process.env.POSTGRES_PASSWORD,port:55432,persistent:true,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
if(!process.env.POSTGRES_PASSWORD)throw new Error('POSTGRES_PASSWORD required');
if(!existsSync('data/local-postgres/PG_VERSION'))await pg.initialise();
await pg.start();
try{await pg.createDatabase('jobhunter');}catch(e){if(!/already exists/i.test(String(e)))throw e;}
const client=pg.getPgClient();await client.connect();await client.query('CREATE SCHEMA IF NOT EXISTS n8n');await client.end();
console.log('Local PostgreSQL listening on 127.0.0.1:55432');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await pg.stop();process.exit(0);});
setInterval(()=>{},60000);
