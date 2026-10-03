import {mkdir,writeFile} from 'node:fs/promises';
const names=['discovery','normalize-dedupe','fit-analysis','cv-factory','application-hitl','reporting-ledger'];
const minutes=Number(process.env.DISCOVERY_INTERVAL_MINUTES??60),hour=Number(process.env.DAILY_SUMMARY_HOUR??20);
const queueMinutes=Number(process.env.QUEUE_INTERVAL_MINUTES??15);
if(!Number.isInteger(minutes)||minutes<1||minutes>1440||!Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(queueMinutes)||queueMinutes<1||queueMinutes>1440)throw new Error('Invalid schedule configuration');
await mkdir('n8n/workflows',{recursive:true});
for(let i=0;i<names.length;i++){
 const stage=i+1, id=`WF-${String(stage).padStart(2,'0')}`;
 const triggers=[
  {id:'manual',name:'Manual Trigger',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0]},
  {id:'subworkflow',name:'Stage Input',type:'n8n-nodes-base.executeWorkflowTrigger',typeVersion:1.1,position:[0,200],parameters:{inputSource:'passthrough'}},
  {id:'webhook',name:'Stage Webhook',type:'n8n-nodes-base.webhook',typeVersion:2,position:[0,400],parameters:{httpMethod:'POST',path:`jobhunter/stage/${stage}`,authentication:'headerAuth',responseMode:'lastNode'},credentials:{httpHeaderAuth:{id:'jobhunter-core',name:'JobHunter internal secret'}}},
  {id:'schedule',name:'Schedule',type:'n8n-nodes-base.scheduleTrigger',typeVersion:1.2,position:[0,-200],parameters:{rule:{interval:[stage===6?{field:'cronExpression',expression:`0 ${hour} * * *`}:{field:'minutes',minutesInterval:stage===1?minutes:queueMinutes}]}}}
 ];
 const action={id:'stage',name:`Execute Stage ${stage}`,type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[300,0],parameters:{method:'POST',url:`http://core:3000/stages/${stage}`,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody:'={{ JSON.stringify($json.body || {}) }}',options:{timeout:420000}},credentials:{httpHeaderAuth:{id:'jobhunter-core',name:'JobHunter internal secret'}}};
 const connections=Object.fromEntries(triggers.map(t=>[t.name,{main:[[{node:action.name,type:'main',index:0}]]}]));
 const nodes=[...triggers,action];
 // Distinct child workflows consume persisted queues; failed later stages do not
 // roll back discovery. Periodic queue triggers also drain pre-existing backlog.
 if(stage<5){
  const next={id:'next',name:`Queue Stage ${stage+1}`,type:'n8n-nodes-base.executeWorkflow',typeVersion:1.3,position:[600,0],parameters:{source:'database',workflowId:{__rl:true,value:`WF-${String(stage+1).padStart(2,'0')}`,mode:'id'},mode:'once',options:{waitForSubWorkflow:false}}};
  nodes.push(next);connections[action.name]={main:[[{node:next.name,type:'main',index:0}]]};
 }
 const wf={id,name:`${id} ${names[i]}`,nodes,connections,active:false,settings:{executionOrder:'v1',timezone:'Europe/Warsaw',saveDataErrorExecution:'all',saveDataSuccessExecution:'none',callerPolicy:'workflowsFromSameOwner'},pinData:{},tags:[]};
 await writeFile(`n8n/workflows/${id}-${names[i]}.json`,JSON.stringify(wf,null,2)+'\n');
}
