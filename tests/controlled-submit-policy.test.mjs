import test from 'node:test';
import assert from 'node:assert/strict';
import {controlledSubmitPermission} from '../services/browser-service/policy.mjs';
test('changing environment-equivalent flags cannot authorize a real submission during Production Gate preparation',()=>{
 const config={enabled:true,dryRun:false,allowRealSubmit:true,allowMockNetwork:false,allowDomains:['jobs.lever.co'],denyDomains:[]};
 assert.equal(controlledSubmitPermission('https://jobs.lever.co/acme/application',config),'CONTROLLED_SUBMIT_AUTHORIZATION_REQUIRED');
 assert.equal(controlledSubmitPermission('https://jobs.lever.co/acme/application',{...config,dryRun:true}),'DRY_RUN');
 assert.equal(controlledSubmitPermission('http://127.0.0.1:3002/apply/fixture',{...config,allowMockNetwork:true,mockHosts:['127.0.0.1'],allowMockSubmit:true}),null);
});
