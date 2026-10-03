# JobHunter architecture and development gates

n8n has six primary stage workflows. Deterministic Node helper modules handle
public feed extraction, SQL state, bounded schema validation and browser actions.
PostgreSQL is the business source of truth; n8n execution history only evidences
workflow runs. Local Ollama performs semantic extraction; final scoring is code.

Core: authenticated internal HTTP service on 3000. Browser: authenticated
Playwright HTTP service on 3001. n8n editor: localhost5678. Mock board: test-only
localhost3002. PostgreSQL native fallback: localhost55432; production Compose
does not expose its port. Ollama remains local at11434.

Read MASTER_SPEC_v2 and IMPLEMENTATION_CLARIFICATIONS for requirements. Stage
acceptance order is discovery → normalization → matching → CV → application →
reporting → complete integration. Parallel development does not waive gates.
Only reports naming the executed workflow and database evidence count as n8n
stage acceptance; helper/module tests establish their narrower verification scope.

The pipeline currently exposes independent stage endpoints; queued stage handoff,
complete application resume integration, operational schedules, production rollout
and full Stage7 remain gates. Six exported JSON files alone are not completion.

Public ATS discovery currently uses configurable employer boards. It does not yet
constitute exhaustive Europe-wide market discovery. Source provenance is retained
separately from canonical jobs. Fictional fixtures are isolated in test schemas.
