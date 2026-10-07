# CV generation performance — 2026-10-07

The primary bottleneck was model work: recent saved successful CVs spent 249–629 seconds writing and 132–229 seconds verifying. The verifier issued separate calls per six claims. These costs are hardware dependent.

`cv-factory-v2.5-extractive-fast` first composes a vacancy-specific document from exact confirmed source clauses and provenance-labelled metadata. It retains role-specific ranking, supported keyword coverage, engineering/IT emphasis, secondary projects, employment, both education records and skill qualifiers. It introduces no free-form candidate claims. Exact-source proof replaces model entailment only for that path; independent PDF geometry, text visibility, identity, binding and raster checks remain mandatory.

Live benchmark: ten real, distinct current vacancies generated and independently registered. Complete generation and registration took 1,229–1,988 ms each (mean 1,558 ms). Local evidence: `data/evidence/cv-fast-production-benchmark.json`. Additional corrected software-test-automation example: 2,069 ms. PDF rendering and QA dominate the fast path.

Auto mode falls back to the existing model writer when language, requested application prose, schema, source proof, or vacancy tailoring cannot be satisfied. Such fallbacks are not promised to finish in seconds. `CV_WRITER_MODE=llm` forces the old path; `extractive` rejects instead of silently falling back. Current in-flight model work is allowed to finish before deploying the new worker through the one-shot independent `scripts/upgrade-cv-after-idle.mjs` helper. No scheduled task is used.

Tests cover exact claims, tampering, provenance, role emphasis, numeric/skill guards, required project breadth, and independent PDF checks. Registered drafts are not permission to submit employer forms.
