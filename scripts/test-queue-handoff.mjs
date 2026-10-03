// Actual sub-workflow wiring with an empty isolated queue: no model/browser action.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
import {Repository} from '../services/core/repository.mjs';
import {createCore} from '../services/core/server.mjs';
import {importWorkflow,n8nCli} from './n8n-bootstrap.mjs';
import {extractExecution} from './test-stage-1.mjs';
const admin=new Repository(),schema='queue_'+randomUUID().replaceAll('-','');
await admin.pool.query(`CREATE SCHEMA ${schema}`);
const connection=new URL(process.env.DATABASE_URL);connection.searchParams.set('options',`-csearch_path=${schema}`);
const repository=new Repository(connection.href),configDir=`data/queue-handoff/${schema}/config`;
await mkdir(configDir,{recursive:true});
await writeFile(`${configDir}/source_registry.yaml`,'sources: []\n');
await writeFile(`${configDir}/search_policy.yaml`,'{}\n');
await writeFile(`${configDir}/candidate_profile.yaml`,'profile_id: queue-fixture\nonboarding:\n  legal_name: UNKNOWN\n');
const core=createCore({repository,token:process.env.CORE_SERVICE_TOKEN,port:3009,configDir,testMode:true});
const names=['discovery','normalize-dedupe','fit-analysis','cv-factory','application-hitl'];
const ids=names.map((_,i)=>`Q-${schema.slice(-8)}-${i+1}`);let report;
try{
 await core.start();
 for(let i=0;i<names.length;i++){
  const wf=JSON.parse(await readFile(`n8n/workflows/WF-${String(i+1).padStart(2,'0')}-${names[i]}.json`,'utf8'));
  wf.id=ids[i];wf.name=`Queue handoff fixture stage ${i+1}`;wf.active=false;
  wf.nodes=wf.nodes.filter(n=>!['n8n-nodes-base.webhook','n8n-nodes-base.scheduleTrigger'].includes(n.type));
  delete wf.connections['Stage Webhook'];delete wf.connections.Schedule;
  for(const node of wf.nodes){if(node.type==='n8n-nodes-base.httpRequest')node.parameters.url=node.parameters.url.replace('http://core:3000','http://127.0.0.1:3009');if(node.type==='n8n-nodes-base.executeWorkflow'){node.parameters.workflowId.value=ids[i+1];node.parameters.options.waitForSubWorkflow=true;}}
  wf.settings.saveDataSuccessExecution='all';await importWorkflow(wf);
 }
 for(const id of [...ids].reverse()){
   const published=await n8nCli(['publish:workflow',`--id=${id}`],{env:{N8N_LOG_LEVEL:'info'}});
   const row=(await admin.pool.query('SELECT id,"activeVersionId" FROM n8n.workflow_entity WHERE id=$1',[id])).rows[0];
   if(!row?.activeVersionId)throw new Error(`Test child ${id} has no published version: ${published.stdout.split(/\r?\n/).filter(line=>/error|fail/i.test(line)).join(' ').slice(0,200)}`);
 }
 const output=await n8nCli(['execute',`--id=${ids[0]}`,'--rawOutput'],{env:{N8N_LOG_LEVEL:'info',N8N_RUNNERS_BROKER_PORT:'5809'}});
 const execution=extractExecution(output.stdout);assert.equal(execution.data.resultData.error,undefined);
 const rows=(await admin.pool.query('SELECT id,status,mode,"workflowId" FROM n8n.execution_entity WHERE "workflowId"=ANY($1::text[]) ORDER BY id',[ids])).rows;
 assert.equal(new Set(rows.map(r=>r.workflowId)).size,5);assert(rows.every(r=>r.status==='success'));
 assert.equal((await repository.pool.query('SELECT count(*)::int n FROM jobs_raw')).rows[0].n,0);
 assert.equal((await repository.pool.query('SELECT count(*)::int n FROM applications')).rows[0].n,0);
 report={status:'PASS',scope:'actual-n8n-subworkflow-handoff-empty-isolated-queues',schema,executions:rows,model_calls:0,application_actions:0};
}catch(error){report={status:'FAIL',schema,error:error.message};process.exitCode=1;}
finally{for(const id of ids){try{await n8nCli(['unpublish:workflow',`--id=${id}`]);}catch{/* Preserve original failure. */}}await mkdir('tests/results',{recursive:true});await writeFile('tests/results/queue-handoff.json',JSON.stringify(report,null,2));await writeFile('docs/QUEUE_HANDOFF_REPORT.md',`# Queue handoff verification\n\nOVERALL: ${report.status}\n\nFive distinct actual n8n workflows link discovery through application processing using Execute Sub-workflow and persisted isolated queues. Diagnostic child calls wait for completion to verify the entire chain; production calls are asynchronous and have periodic backlog triggers. n8n 2.x requires published child versions; only isolated test copies are published and unpublished during this check. Empty source queues avoid model/browser/application actions.\n\nExecutions: ${report.executions?.map(r=>r.id).join(', ')??'not completed'}. ${report.error??''}\n\nRun: node --env-file=.env scripts/test-queue-handoff.mjs. Evidence: tests/results/queue-handoff.json.\n`);if(core.server.listening)await core.stop();else await repository.close();await admin.close();console.log(JSON.stringify(report));}
