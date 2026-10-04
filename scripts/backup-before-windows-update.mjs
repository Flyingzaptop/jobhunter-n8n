import {mkdir,cp,access,writeFile} from 'node:fs/promises';
import path from 'node:path';
const workspace=path.resolve('.'),source=path.resolve('data/local-postgres');
const target=path.resolve('data/backups',`windows-update-cluster-${new Date().toISOString().replace(/[:.]/g,'-')}`);
if(!source.startsWith(workspace+path.sep)||!target.startsWith(workspace+path.sep))throw new Error('Backup paths outside workspace');
try{await access(path.join(source,'postmaster.pid'));throw new Error('Stop PostgreSQL cleanly before physical backup');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(path.dirname(target),{recursive:true});await cp(source,target,{recursive:true,errorOnExist:true,force:false});
const proof={kind:'CLEAN_SHUTDOWN_PHYSICAL_CLUSTER_BACKUP',directory:target,source,created_at:new Date().toISOString(),restore_requires_same_postgresql_major:true};
await writeFile(path.join(path.dirname(target),'latest-windows-update.json'),JSON.stringify(proof,null,2),{mode:0o600});console.log(JSON.stringify({backup_saved:true,directory:target}));
