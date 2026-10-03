# Implementation contracts

User clarifications in IMPLEMENTATION_CLARIFICATIONS.md override master ambiguities.
Implementation language: Node.js 24, ESM, native node:test; PostgreSQL via pg.
Root package owns dependencies: pg, yaml, ajv, playwright, pdf-parse.
Orchestrator helper HTTP service at services/core/server.mjs port 3000.
Each primary n8n workflow invokes authenticated stage endpoints on core.
Core exports deterministic stage functions; SQL migrations own business state.
All services fail closed for real submissions. Fixtures never enter real profile.

Ownership for initial parallel work:
- discovery agent: services/core/discovery.mjs, normalization.mjs, tests/stage1.test.mjs, stage2.test.mjs, tests/fixtures/discovery*, config/source_registry.yaml.
- matching agent: services/core/fit.mjs, llm.mjs, config/candidate_profile*, search_policy*, answer_memory*, prompts/, tests/stage3.test.mjs.
- browser agent: services/browser-service/, services/mock-job-board/, tests/browser*.test.mjs.
- root: infrastructure, DB, workflow exports, core server/repository, CV, reporting, integration.

Stage functions accept repository adapter (document implementation needs clearly).
Raw discovery contract: source_name, source_item_id, source_url, title_hint, company_hint, location_hint, published_at, raw_payload.
Canonical job: job_id, canonical_url, application_url, company, title, location, country, work_mode, description_text, content_hash, availability_status.
Fit exports analyzeJob({job, profile, policy, llm}), scoreRequirements(requirements), routeAnalysis(...); returns fact-linked structured analysis. LLM gateway calls real Ollama and schema validates, mocks explicit injection only.
Browser service: authenticated HTTP JSON; Playwright; port 3001. Mock site: port 3002. Browser test permission must be explicit and destination restricted.
No agent commits or pushes; root owns coherent commits and remote sync.
Acceptance order remains Stage 1 to Stage 7 even when implementation overlaps.
