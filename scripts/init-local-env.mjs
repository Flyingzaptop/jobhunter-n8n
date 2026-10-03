import {existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
if(existsSync('.env'))throw new Error('.env already exists; refusing overwrite');
let text=await readFile('.env.example','utf8');
for(const key of ['POSTGRES_PASSWORD','BROWSER_SERVICE_TOKEN','CORE_SERVICE_TOKEN','N8N_ENCRYPTION_KEY'])text=text.replace(`${key}=\n`,`${key}=${randomBytes(24).toString('hex')}\n`);
text=text.replace('OLLAMA_BASE_URL=http://host.docker.internal:11434','OLLAMA_BASE_URL=http://127.0.0.1:11434');
text=text.replace('DATABASE_URL=\n',`DATABASE_URL=postgresql://jobhunter:${text.match(/POSTGRES_PASSWORD=(.+)/)[1]}@127.0.0.1:55432/jobhunter\n`);
await writeFile('.env',text);console.log('Created ignored .env; secrets omitted');
