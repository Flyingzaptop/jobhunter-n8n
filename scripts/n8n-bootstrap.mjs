import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function n8nEnvironment(extra = {}) {
  if (!process.env.DATABASE_URL || !process.env.N8N_ENCRYPTION_KEY) throw new Error('DATABASE_URL and N8N_ENCRYPTION_KEY required');
  const db = new URL(process.env.DATABASE_URL);
  return { ...process.env, DB_TYPE: 'postgresdb', DB_POSTGRESDB_HOST: db.hostname,
    DB_POSTGRESDB_PORT: db.port || '5432', DB_POSTGRESDB_DATABASE: db.pathname.slice(1),
    DB_POSTGRESDB_USER: decodeURIComponent(db.username), DB_POSTGRESDB_PASSWORD: decodeURIComponent(db.password),
    DB_POSTGRESDB_SCHEMA: 'n8n', N8N_USER_FOLDER: resolve('data/n8n'), N8N_HOST: '127.0.0.1',
    N8N_LISTEN_ADDRESS: '127.0.0.1', N8N_PORT: '5678', N8N_PROTOCOL: 'http', N8N_SECURE_COOKIE: 'false',
    GENERIC_TIMEZONE: 'Europe/Warsaw', N8N_DIAGNOSTICS_ENABLED: 'false', N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
    N8N_PERSONALIZATION_ENABLED: 'false', N8N_LOG_LEVEL: 'warn', EXECUTIONS_MODE: 'regular', ...extra };
}

export async function n8nCli(args, { timeoutMs = 300_000, env = {} } = {}) {
  const entry = resolve('.tools/n8n/node_modules/n8n/bin/n8n');
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { env: n8nEnvironment(env), windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`n8n ${args[0]} timed out`)); }, timeoutMs);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => {
      clearTimeout(timeout);
      if (code !== 0) { reject(new Error(`n8n ${args[0]} failed (${code}): ${stderr || stdout}`)); return; }
      resolvePromise({ stdout, stderr, exit_code: code });
    });
  });
}

export async function importWorkflow(workflow, suffix = '') {
  const folder = resolve('data/n8n-import');
  await mkdir(folder, { recursive: true });
  const path = resolve(folder, `${workflow.id}${suffix}.json`);
  await writeFile(path, JSON.stringify(workflow, null, 2));
  await n8nCli(['import:workflow', `--input=${path}`]);
  return workflow.id;
}

export async function bootstrapN8n() {
  if (!process.env.CORE_SERVICE_TOKEN) throw new Error('CORE_SERVICE_TOKEN required');
  await mkdir('data/n8n', { recursive: true });
  await mkdir('data/n8n-import', { recursive: true });
  const credentialPath = resolve('data/n8n-import/credentials.json');
  await writeFile(credentialPath, JSON.stringify([{ id: 'jobhunter-core', name: 'JobHunter internal secret',
    type: 'httpHeaderAuth', data: { name: 'x-jobhunter-token', value: process.env.CORE_SERVICE_TOKEN } }]), { mode: 0o600 });
  try { await n8nCli(['import:credentials', `--input=${credentialPath}`]); }
  finally { await unlink(credentialPath); }
  const imported = [];
  for (const filename of (await readdir('n8n/workflows')).filter(name => /^WF-\d\d-.*\.json$/.test(name)).sort()) {
    const workflow = JSON.parse(await readFile(`n8n/workflows/${filename}`, 'utf8'));
    for (const node of workflow.nodes) if (node.type === 'n8n-nodes-base.httpRequest') {
      node.parameters.url = node.parameters.url.replace('http://core:3000', 'http://127.0.0.1:3000');
    }
    // Imported workflows are deliberately inactive until explicit activation.
    workflow.active = false;
    imported.push(await importWorkflow(workflow));
  }
  return { imported, credentials_imported: 1, active_workflows: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await bootstrapN8n();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
