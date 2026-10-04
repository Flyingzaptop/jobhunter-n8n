import {Repository} from '../services/core/repository.mjs';
import {createCore} from '../services/core/server.mjs';
import {createProductionContinuousWorker} from '../services/core/continuous-worker.mjs';
if(process.env.CONTINUOUS_WORKER_ENABLED!=='true'||process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT==='true')
 throw new Error('AUTHORIZED_CONTROLLED_DRY_RUN_REQUIRED');
const repository=new Repository(process.env.DATABASE_URL,{max:32});
await repository.migrate();
const core=createCore({repository});
const worker=await createProductionContinuousWorker({repository,core});
const controller=new AbortController();
process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
console.log(JSON.stringify({event:'CONTINUOUS_WORKER_STARTED',lanes:6,dry_run:true,real_submit_enabled:false}));
try{await worker.start(controller.signal);}finally{await repository.close();}
