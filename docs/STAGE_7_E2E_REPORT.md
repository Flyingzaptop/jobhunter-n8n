# Stage 7 — full mock pipeline

OVERALL: PASS

Start: 2026-10-03T18:53:22.133Z. End: 2026-10-03T18:58:46.324Z. Total: 324.2 seconds.

All six actual n8n workflows ran with PostgreSQL state, real local Ollama fit analysis of all ten discovered vacancies, a factual PDF and the eight-step browser application. Normal ranking selected the candidate; no target-ID filter or fake semantic gateway was used. Human fixture replies resolved an unknown date, image CAPTCHA and salary validation. Core restart preserved checkpoint state; mock submission was confirmed exactly once; the ledger was idempotent.

| Stage | Stored successful n8n CLI executions | Duration (seconds) |
|---|---|---:|
| 1 | 143 | 9.8 |
| 2 | 144 | 9.4 |
| 3 | 145, 146, 147, 148, 149, 150, 151, 152, 158, 159 | 241.7 |
| 4 | 160 | 10.3 |
| 5 | 161, 162 | 28.1 |
| 6 | 163, 164 | 18.9 |

DB metrics: 21 raw, 10 unique, 10 analyzed, 5 suitable, 1 CV, 1 submitted, 0 awaiting user/failed/skipped. AUTO_APPLY/REVIEW/STRETCH remain separate: AUTO_APPLY=1, REJECT=5, REVIEW=4. Backend submit POST requests: 1; confirmed submissions: 1.

Normal ranking selected **Mechanical R&D Engineer**, AUTO_APPLY, fit 97.62. Confirmation: `MOCK-d2f51b9f-80d0-4d84-b302-24cea6eb8f79`. Tailored headline and source statements verified; known email/phone/portfolio/GitHub/location match CV JSON, HTML and parsed PDF; PDF text QA: PASS. SHA256: `0fb79e3bf110f0faa6d76c08501eb1accfcb8f898a4f1ff48f25503e384f022e`. Rendered preview: `C:\Users\r3d_flzp\Desktop\JobHunter n8n\data\test-stage7\stage7_42706aa737754c38aee330cf8c8f0327\cv\2026-10\Fixture_Engineering_mechanical-engineer-42\2d29e19a-3889-509a-bf55-0a3065aeb926\qa-page.png`; visual review status: PASS (manual inspection; readable contact line, clear provenance and dates, no clipping or placeholders).

Persistence verifies candidate/application/CV/confirmation identity and answered questions. CAPTCHA PNG bytes and Telegram request correlation were verified. Dynamic timezone field, human salary validation correction, untouched honeypot, unchecked optional marketing, audited technical consent, exactly one backend submit POST, and unchanged ledger after repeated WF-06 were verified. Daily summary totals and captured notification match the PostgreSQL counts.

Environment: Windows native Node/PostgreSQL/n8n CLI; container runtime not exercised by this acceptance run. Versions: Node v24.14.0, PostgreSQL 18.4, n8n 2.41.6, Ollama 0.32.5; model qwen3.5:4b; tested Git base `fdb898202244f28e02107b37b72434ff128b256d`. Source hashes record the working tree used by this run. Failed assertions: 0.

Semantic prompt: fit-analysis-v2.6-compact; all ten persisted real-model analyses use this version. Separate matching unit evidence: 45/45 PASS (explicit test gateways, distinct from the real Ollama integration above). Browser input-ID/provenance regression: 2/2 PASS. Submission notification and its audit event occurred exactly once despite duplicate WF-05.

Machine evidence: `tests/results/stage7.json`. Isolated schema: `stage7_42706aa737754c38aee330cf8c8f0327`. Artifacts: `C:\Users\r3d_flzp\Desktop\JobHunter n8n\data\test-stage7\stage7_42706aa737754c38aee330cf8c8f0327`.

Run: `node --env-file=.env scripts/test-stage-7.mjs --skip-bootstrap` (PowerShell: `.\scripts\test-stage-7.ps1 -SkipBootstrap`; shell: `./scripts/test-stage-7.sh --skip-bootstrap`). Real submissions stay disabled. Telegram transport is captured locally; real bot delivery and the separate post-Stage-7 real-discovery readiness gate remain unverified by this test.
