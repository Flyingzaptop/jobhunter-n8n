import {spawnSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/stage3.test.mjs'], {encoding: 'utf8'});
const output = `${run.stdout || ''}\n${run.stderr || ''}`;
const count = key => Number(output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] || 0);
const report = {status: run.status === 0 ? 'PASS' : 'FAIL', kind: 'deterministic-unit-tests-with-explicit-gateway-mocks',
  tests: count('tests'), passed: count('pass'), failed: count('fail'),
  timestamp: new Date().toISOString(), cases: [...output.matchAll(/^ok \d+ - (.+)$/gm)].map(m => m[1])};
await mkdir(new URL('./results/', import.meta.url), {recursive: true});
await writeFile(new URL('./results/stage3-unit.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
process.exitCode = run.status ?? 1;
