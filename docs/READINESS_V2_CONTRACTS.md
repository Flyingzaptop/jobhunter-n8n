# V2 implementation contracts

Baseline64ab595 is retained. READINESS_V2_REQUEST is the human task;
REAL_MARKET_OVERRIDE takes precedence. No new fake job board for acceptance.
Real employer submissions must remain0: DRY_RUN=true, ALLOW_REAL_SUBMIT=false.

Ownership:
- market agent: discovery-v2 modules/config/search queries/catalog, discovery tests,
  source health helper/migrations003_market.sql, source-access evidence/docs.
- dashboard agent: services/dashboard/web React/TypeScript/Vite frontend only.
- CV agent: services/core/cv-v2.mjs, CV templates/prompts/tests and draft generation.
- root: dashboard server/API, observability/migration002_control.sql, core wiring,
  browser ATS adapters/real harness, retry/dead-letter, Telegram durability, integration.
No agents commit/push. Root owns logical remote milestones.

Dashboard backend localhost3020. Frontend same-origin /api; served compiled dist.
No service tokens or secrets in client bundle/localStorage. Login password entry
POST /api/auth/login {password}; session HttpOnly cookie; returns {csrf_token}.
GET /api/auth/me returns {authenticated:true,csrf_token}; POST /api/auth/logout.
All /api routes authenticated; mutation additionally X-CSRF-Token. Login401 is a
normal state, never render fake data to compensate. Credentials remain ignored.

API response envelopes {data:...}; paged {data:[],total,limit,offset}.
GET /api/overview -> {mode:{dry_run,real_submit_enabled,application_fill_enabled,
paused},health:{postgres,core,browser,ollama,n8n,telegram},versions:{model,
profile,policy},latest:{discovery,analysis,cv,application},counts,pipeline:[...] }.
GET /api/pipeline -> array stage/run/status/message/counts/time/current entity.
GET /api/runs?stage=&status=&limit=&offset=; /api/runs/:id -> run+events.
GET /api/jobs?q=&decision=&source=&company=&country=&role_family=&work_format=
&min_fit=&max_fit=&analyzed=&cv=&application_status=&limit=&offset=.
Job rows retain SQL snake_case; nested analysis latest structured fields.
GET /api/jobs/:id -> {job,raw_sources,source_mappings,analysis,facts,cvs,
applications,events,priority_components}. GET /api/facts/:id -> exact verified fact.
GET /api/applications ; /api/applications/:id -> application/questions/events/job/cv.
GET /api/hitl -> {questions,onboarding,manual,unknown_submissions}; answers initially
observation-only and use the existing Telegram correlation, not a second subsystem.
GET /api/cvs ; /api/cvs/:id -> DB record+safe manifest/qa/fact map/structured CV.
GET /api/cvs/:id/pdf -> approved DB artifact only (not arbitrary file paths).
GET /api/sources -> catalog plus persisted health/capability/auth/queries metrics.
GET /api/analytics -> actual existing reporting daily/cumulative/weekly data.
GET /api/system -> overview health, sanitized configuration and onboarding fields.
GET /api/browser/:session_id -> sanitized observer state, no cookies/password values.
GET /api/browser/:session_id/image -> in-memory PNG, no 1–2s persistent screenshot files.
GET /api/events/stream SSE named event `update`: {sequence,at,kind,entity_id}; UI
refreshes visible views upon events. Heartbeats. Never hidden reasoning/raw PII prompts.
POST /api/control/pause ; /resume ; /trigger {stage:1|2|3|4|5|6} -> {run_id,status:QUEUED}.
Controls invoke real n8n orchestration via bounded native CLI; validation rejects
arbitrary URLs, commands, configuration changes or real-submit enablement.
Unsupported/null data must be visibly UNKNOWN/not recorded, never invented.

Discovery v2 export runMarketDiscovery({repository,observer?,registryPath?,
sourceIds?,maxSources?,signal?}); actual public GET/read-only allowed adapters,
persist source health and search progress through observer async callbacks.
Observer function receives {event,source_id,platform,query,geography,cursor,
count,message,status,latency_ms,error_code}; do not include headers/secrets.
Catalog blocked entries remain visible with AUTH_REQUIRED/USER_SESSION_REQUIRED/
MANUAL_DISCOVERY_FALLBACK, never count them operational without real evidence.
No restrictive pre-fit title filtering; annotate broad role/query evidence only.

CV v2 export buildTailoredCv({job,profile,analysis,llm,repository?,outputRoot?});
controlled writer plus independent entailment checks and deterministic fact rules.
Unknown real identity cannot become a fixture/placeholder. Content draft with
BLOCKED_IDENTITY may be saved with factual QA and identity QA separate; full PDF
PASS requires actual known identity. Maintain original createCv API/wrapper backwards
compatibility by root integration. Never run Ollama concurrently across agents;
coordinate root GPU ownership before real inference.
