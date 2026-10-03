import {mkdir,writeFile} from 'node:fs/promises';
const names=['discovery','normalize-dedupe','fit-analysis','cv-factory','application-hitl','reporting-ledger'];
const minutes=Number(process.env.DISCOVERY_INTERVAL_MINUTES??60),hour=Number(process.env.DAILY_SUMMARY_HOUR??20);
if(!Number.isInteger(minutes)||minutes<1||minutes>1440||!Number.isInteger(hour)||hour<0||hour>23)throw new Error('Invalid schedule configuration');
await mkdir('n8n/workflows',{recursive:true});
for(let i=0;i<names.length;i++){
 const stage=i+1, id=`WF-${String(stage).padStart(2,'0')}`;
 const triggers=[{id:'manual',name:'Manual Trigger',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0]}, {id:'webhook',name:'Stage Webhook',type:'n8n-nodes-base.webhook',typeVersion:2,position:[0,200],parameters:{httpMethod:'POST',path:`jobhunter/stage/${stage}`,authentication:'headerAuth',responseMode:'lastNode'},credentials:{httpHeaderAuth:{id:'jobhunter-core',name:'JobHunter internal secret'}}}];
 if(stage===1||stage===6)triggers.push({id:'schedule',name:'Schedule',type:'n8n-nodes-base.scheduleTrigger',typeVersion:1.2,position:[0,-200],parameters:{rule:{interval:[stage===1?{field:'minutes',minutesInterval:minutes}:{field:'cronExpression',expression:`0 ${hour} * * *`}]}}});
 const action={id:'stage',name:`Execute Stage ${stage}`,type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[300,0],parameters:{method:'POST',url:`http://core:3000/stages/${stage}`,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody:'={{ JSON.stringify($json.body || {}) }}',options:{timeout:300000}},credentials:{httpHeaderAuth:{id:'jobhunter-core',name:'JobHunter internal secret'}}};
 const connections=Object.fromEntries(triggers.map(t=>[t.name,{main:[[{node:action.name,type:'main',index:0}]]}]));
 const wf={id,name:`${id} ${names[i]}`,nodes:[...triggers,action],connections,active:false,settings:{executionOrder:'v1',timezone:'Europe/Warsaw',saveDataErrorExecution:'all',saveDataSuccessExecution:'none'},pinData:{},tags:[]};
 await writeFile(`n8n/workflows/${id}-${names[i]}.json`,JSON.stringify(wf,null,2)+'\n');
}
