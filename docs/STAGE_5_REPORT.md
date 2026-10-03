# Stage 5 — application and human relay

Module result: **PASS**. Acceptance: **CONDITIONAL_PENDING_STAGE3**.

A real n8n WF-05 execution filled the eight-step mock application using PostgreSQL state, a generated factual PDF, and Chromium. The deliberately unknown start date paused for a correlated Telegram reply. Core was stopped and restarted at the pause; state and uploaded PDF hash survived. A foreign chat and a reused reply were rejected. A CAPTCHA screenshot was sent through the real Telegram class with an injected test transport; the isolated human fixture adapter provided the code without OCR. The final review passed and the application stopped at READY_TO_SUBMIT with DRY_RUN=true and ALLOW_MOCK_SUBMIT=false. Backend submission count remained zero. Pause prevented a new run.

This is a Stage 5 module acceptance with verified seeded analysis. It does not claim the Stage 3 → Stage 5 pipeline has passed, and it does not verify live Telegram credentials or live employer forms.

Run: `node --env-file=.env scripts/test-stage-5.mjs`. Evidence: `tests/results/stage5.json`.
