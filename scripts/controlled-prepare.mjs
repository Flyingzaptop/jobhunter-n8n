import {readFile,mkdir,writeFile} from 'node:fs/promises';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {createControlledPreparation} from '../services/core/controlled-preparation.mjs';
import {runApplication} from '../services/core/application.mjs';
import {reverifyMarketJob} from '../services/core/discovery-v2.mjs';
import {browserConfig} from '../services/browser-service/server.mjs';
import {Telegram} from '../services/core/telegram.mjs';
import {runObserved} from '../services/core/observability.mjs';
const [jobId,cvId]=process.argv.slice(2);
const repository=new Repository();
try{
 await repository.migrate();
 const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));
 const application=await createControlledPreparation({repository,jobId,cvId,profile});
 const result=await runObserved(repository,5,{application_id:application.application_id},()=>runApplication({repository,jobId,applicationId:application.application_id,profile,telegram:new Telegram(),
   config:{...browserConfig(),enabled:true,dryRun:true,allowRealSubmit:false,allowMockSubmit:false},
   verifyOpen:async({job})=>(await reverifyMarketJob({job,repository})).status==='OPEN'}),{trigger:'controlled-preparation',mode:'REAL'});
 await mkdir('data/controlled-preparation',{recursive:true});
 await writeFile(`data/controlled-preparation/${application.application_id}.json`,JSON.stringify({scope:'REAL_CONTROLLED_PREPARATION',application_id:application.application_id,job_id:jobId,cv_id:cvId,...result,real_employer_submissions:0,real_submit_enabled:false},null,2),{mode:0o600});
 console.log(JSON.stringify({application_id:application.application_id,status:result.status,reason:result.reason,submit_blocked_reason:result.submit_blocked_reason,real_employer_submissions:0}));
}finally{await repository.close();}
