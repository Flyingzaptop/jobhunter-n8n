# Stage 3 acceptance report

OVERALL: PASS

Model: qwen3.5:4b. Gateway: real local Ollama. Execution: real n8n CLI; PostgreSQL schema stage3_c2c483dcc8684ba895f0d0459ab9ebe1.

| Synthetic vacancy | Result | Fit | Observed routing |
|---|---|---:|---|
| mechanical-engineer-42 | PASS | 88.99 | AUTO_APPLY |
| fea-junior | PASS | 97.22 | REVIEW |
| prototype-design | PASS | 96.67 | REVIEW |
| r-and-d-munich | PASS | 88.89 | REVIEW |
| cad-stretch | PASS | 50 | STRETCH |
| senior-catia | PASS | 0 | REJECT |
| nurse | PASS | 25 | REJECT |
| chef | PASS | 30 | REJECT |

Repeated primary role routing stable: true.
Applications created: 0; real submissions: 0.

Scope: 8 real-model synthetic vacancy analyses and persisted n8n executions. Conservative REVIEW is permitted for genuinely unknown mandatory qualifications and hiring routes. The cad-stretch case requires an observed real-model STRETCH decision in the 45–59 score band.

Separate deterministic unit result: 31/31.
Detailed requirement-to-fact maps, prompt/profile versions and execution IDs: tests/results/stage3.json.

Run: node --env-file=.env tests/stage3-unit-report.mjs; node --env-file=.env scripts/test-stage-3.mjs --skip-bootstrap.
