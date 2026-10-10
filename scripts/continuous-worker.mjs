import {Repository} from '../services/core/repository.mjs';
import {createCore} from '../services/core/server.mjs';
import {createProductionContinuousWorker} from '../services/core/continuous-worker.mjs';
import {hardwarePaused} from '../services/core/hardware-pause.mjs';
import {recoverStrandedApplications} from '../services/core/application-recovery.mjs';
if(await hardwarePaused())throw new Error('HARDWARE_PAUSED');
if(process.env.CONTINUOUS_WORKER_ENABLED!=='true'||process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT==='true')
 throw new Error('AUTHORIZED_CONTROLLED_DRY_RUN_REQUIRED');
const repository=new Repository(process.env.DATABASE_URL,{max:Math.min(50,Math.max(16,8+Number(process.env.APPLICATION_PREPARATION_WORKERS??2)+Number(process.env.APPLICATION_SUBMIT_WORKERS??1)+Number(process.env.SOURCE_VALIDATION_WORKERS??1)))});
await repository.migrate();
await recoverStrandedApplications(repository);
const core=createCore({repository});
const worker=await createProductionContinuousWorker({repository,core});
const controller=new AbortController();
process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
console.log(JSON.stringify({event:'CONTINUOUS_WORKER_STARTED',lanes:worker.lanes.length,dry_run:true,real_submit_enabled:false}));
try{await worker.start(controller.signal);}finally{await repository.close();}
