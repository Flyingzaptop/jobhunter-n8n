import {createBrowserService,browserConfig} from '../services/browser-service/server.mjs';
// This supervised acceptance run uses human CAPTCHA only. Owner configuration
// and the separately implemented automatic module are not changed.
const service=await createBrowserService({...browserConfig(),autoCaptcha:false,maxSessions:2});
await service.listen();
console.log(JSON.stringify({event:'CONTROLLED_BROWSER_STARTED',engine:'obscura',manual_captcha_only:true}));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await service.close();process.exit(0);});
