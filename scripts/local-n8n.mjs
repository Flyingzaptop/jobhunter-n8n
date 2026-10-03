import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { n8nEnvironment } from './n8n-bootstrap.mjs';
const child = spawn(process.execPath, [resolve('.tools/n8n/node_modules/n8n/bin/n8n'), 'start'], {
  env: n8nEnvironment({ N8N_LOG_LEVEL: process.env.LOG_LEVEL ?? 'info' }), windowsHide: true, stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('close', code => { process.exitCode = code ?? 1; });
