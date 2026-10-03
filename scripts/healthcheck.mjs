import {Repository} from '../services/core/repository.mjs';import {OllamaClient} from '../services/core/llm.mjs';
const results={};const repo=new Repository();try{await repo.pool.query('SELECT 1');results.postgres=true;}catch{results.postgres=false;}finally{await repo.close();}
try{results.ollama=await new OllamaClient().health();}catch{results.ollama={ok:false};}
for(const [name,url] of [['core','http://127.0.0.1:3000/health'],['n8n','http://127.0.0.1:5678/healthz'],['browser','http://127.0.0.1:3001/health']]){try{results[name]=(await fetch(url,{signal:AbortSignal.timeout(5000)})).ok;}catch{results[name]=false;}}
results.telegram_configured=Boolean(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_ALLOWED_CHAT_ID);console.log(JSON.stringify(results,null,2));if(!results.postgres||!results.ollama.ok||!results.core||!results.n8n||!results.browser)process.exitCode=1;
