import {Repository} from '../services/core/repository.mjs';
import {mkdir,readdir,readFile,rename,writeFile,rm} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createGzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const quote=value=>'"'+value.replaceAll('"','""')+'"';

// A consistent logical DATA snapshot. Restoring requires the matching schema;
// this is deliberately not advertised as a full PostgreSQL cluster backup.
export async function backupRowSnapshot({repository,directory=path.resolve('data/backups'),schema='public'}={}){
 if(!/^[a-z][a-z0-9_]*$/.test(schema))throw new Error('INVALID_SNAPSHOT_SCHEMA');
 await mkdir(directory,{recursive:true});
 const target=path.join(directory,`rows-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}.jsonl.gz`);
 const temporary=target+'.partial',client=await repository.pool.connect(),hash=createHash('sha256');
 const counts={};let transaction=false;
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');transaction=true;
  const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename",[schema])).rows;
  const migrations=[];
  for(const name of (await readdir('db/migrations')).filter(name=>name.endsWith('.sql')).sort())migrations.push({name,sql:await readFile(path.join('db/migrations',name),'utf8')});
  async function* records(){
   yield JSON.stringify({kind:'header',format:'JOBHUNTER_CONSISTENT_ROWS_V1',schema,created_at:new Date().toISOString(),matching_schema_required:true,migrations})+'\n';
   for(const {tablename} of tables){
    counts[tablename]=0;
    const columns=(await client.query('SELECT column_name,data_type,udt_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',[schema,tablename])).rows;
    yield JSON.stringify({kind:'table',table:tablename,columns})+'\n';
    await client.query(`DECLARE snapshot_rows NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS row_json FROM ${quote(schema)}.${quote(tablename)} t`);
    for(;;){const rows=(await client.query('FETCH FORWARD 100 FROM snapshot_rows')).rows;if(!rows.length)break;
     for(const row of rows){counts[tablename]++;yield `{"kind":"row","table":${JSON.stringify(tablename)},"data":${row.row_json}}\n`;}
    }
    await client.query('CLOSE snapshot_rows');
   }
   yield JSON.stringify({kind:'complete',counts})+'\n';
  }
  const gzip=createGzip({level:1});gzip.on('data',chunk=>hash.update(chunk));
  await pipeline(Readable.from(records()),gzip,createWriteStream(temporary,{flags:'wx',mode:0o600}));
  await client.query('COMMIT');transaction=false;
  await rename(temporary,target);
  const receipt={kind:'CONSISTENT_LOGICAL_ROW_SNAPSHOT',path:target,sha256:hash.digest('hex'),counts,matching_schema_required:true};
  await writeFile(target+'.receipt.json',JSON.stringify(receipt,null,2),{mode:0o600});
  return receipt;
 }catch(error){if(transaction)await client.query('ROLLBACK').catch(()=>{});await rm(temporary,{force:true}).catch(()=>{});throw error;}
 finally{client.release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const repository=new Repository();try{const result=await backupRowSnapshot({repository});console.log(JSON.stringify({saved:true,path:result.path,sha256:result.sha256,tables:Object.keys(result.counts).length}));}finally{await repository.close();}
}
