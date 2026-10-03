// Explicit real local inference check, distinct from deterministic mocked gateway tests.
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import YAML from 'yaml';
import {analyzeJob} from '../services/core/fit.mjs';
import {OllamaClient} from '../services/core/llm.mjs';

const profile = YAML.parse(await readFile(new URL('./fixtures/candidate_profile_test.yaml', import.meta.url), 'utf8'));
const mock = await fetch('http://127.0.0.1:3002/api/jobs', {signal: AbortSignal.timeout(5000)}).then(r => r.json()).catch(() => null);
const jobs = Array.isArray(mock) ? mock : mock?.jobs;
const fixtures = jobs || (await import('../services/mock-job-board/server.mjs')).vacancies;
const target = fixtures.find(j => j.id === 'mechanical-engineer-42');
if (!target) throw new Error('Mock mechanical-engineer-42 fixture missing');
const job = {...target, job_id: target.id};
const llm = new OllamaClient();
const start = performance.now();
const save = async report => {
  const dir = new URL('./results/', import.meta.url);
  await mkdir(dir, {recursive: true});
  await writeFile(new URL('stage3-ollama-smoke.json', dir), JSON.stringify({...report, timestamp: new Date().toISOString()}, null, 2));
  console.log(JSON.stringify(report));
};
try {
  const analysis = await analyzeJob({job, profile, llm});
  await save({status: 'PASS', gateway: 'real-local-ollama', model: llm.model, fixture_job_id: job.job_id,
    elapsed_ms: Math.round(performance.now() - start), requirements: analysis.requirements.length,
    requirement_details: analysis.requirements.map(r => ({requirement: r.requirement, match: r.match, reason: r.reason})),
    overall_fit: analysis.overall_fit, decision: analysis.decision,
    work_format_class: analysis.work_format_class, reasons: analysis.reasons, prompt_version: analysis.prompt_version});
} catch (error) {
  await save({status: 'FAIL', gateway: 'real-local-ollama', model: llm.model, fixture_job_id: job.job_id,
    elapsed_ms: Math.round(performance.now() - start), error: error.message});
  process.exitCode = 1;
}
