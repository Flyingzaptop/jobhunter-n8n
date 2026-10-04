import {readFile} from 'node:fs/promises';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {BrowserClient} from '../services/core/application.mjs';
import {browserConfig} from '../services/browser-service/server.mjs';
import {recoverPreloadedCaptcha} from '../services/core/captcha-preload-recovery.mjs';
const applicationId=process.argv[2];if(applicationId!=='07ee7cc8-3857-42b2-978c-cbe46258cf0e')throw new Error('REVIEWED_LINEAR_APPLICATION_REQUIRED');
const repository=new Repository();try{await repository.migrate();const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));console.log(JSON.stringify(await recoverPreloadedCaptcha({repository,browser:new BrowserClient(),applicationId,profile,config:browserConfig()})));}finally{await repository.close();}
