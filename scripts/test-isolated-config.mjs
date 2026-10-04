import {spawn} from 'node:child_process';
process.loadEnvFile('.env');
const environment={...process.env,OLLAMA_PROVIDER:'local'};
for(const key of ['OLLAMA_BASE_URL','LLM_FAST_MODEL','LLM_STRONG_MODEL','CV_WRITER_MODEL','CV_VERIFIER_MODEL','OLLAMA_API_KEY','OPENROUTER_API_KEY'])delete environment[key];
// Regression gateways are explicit mocked transports; this does not start Ollama.
const child=spawn(process.execPath,['--test','--test-concurrency=1','--test-reporter=spec','--test-reporter-destination=tests/results/openrouter-migration-regression.txt','tests/*.test.mjs'],{env:environment,windowsHide:true,stdio:'inherit'});
child.on('exit',code=>process.exitCode=code??1);
