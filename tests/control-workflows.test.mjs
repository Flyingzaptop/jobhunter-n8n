import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {controlWorkflowCopy} from '../scripts/n8n-bootstrap.mjs';
test('manual dashboard workflow copies publish dependencies without enabling scheduled or public triggers',async()=>{
 const original=JSON.parse(await readFile('n8n/workflows/WF-02-normalize-dedupe.json','utf8'));
 const saved=structuredClone(original),copy=controlWorkflowCopy(original);
 assert.deepEqual(original,saved);assert.equal(copy.id,'CC-WF-02');
 assert.ok(!copy.nodes.some(n=>['n8n-nodes-base.scheduleTrigger','n8n-nodes-base.webhook'].includes(n.type)));
 assert.equal(copy.nodes.find(n=>n.type==='n8n-nodes-base.httpRequest').parameters.url,'http://127.0.0.1:3000/stages/2');
 const child=copy.nodes.find(n=>n.type==='n8n-nodes-base.executeWorkflow');
 assert.equal(child.parameters.workflowId.value,'CC-WF-03');assert.equal(child.parameters.options.waitForSubWorkflow,true);
 assert.equal(copy.connections.Schedule,undefined);assert.equal(copy.connections['Stage Webhook'],undefined);
 assert.throws(()=>controlWorkflowCopy({...original,id:'arbitrary'}));
});
