import { isolatedStageTest } from './test-stage-1.mjs';
const report = await isolatedStageTest(2, { bootstrap: !process.argv.includes('--skip-bootstrap') });
process.stdout.write(`${JSON.stringify(report)}\n`);
