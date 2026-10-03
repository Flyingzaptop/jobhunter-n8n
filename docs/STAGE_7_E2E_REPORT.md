# Stage 7 — full mock pipeline

OVERALL: FAIL

Start: 2026-10-03T12:15:43.548Z. End: 2026-10-03T12:20:20.042Z. Total: 276.5 seconds.

Failure: The expression evaluated to a falsy value:

  assert.ok(sent.some(message => message.text?.includes('JobHunter summary') && message.text.includes('Discovered: 21')
. No successful full-pipeline claim is made.

| Stage | Stored successful n8n CLI executions | Duration (seconds) |
|---|---|---:|
| 1 | 76 | 9.4 |
| 2 | 77 | 9.1 |
| 3 | 78, 79, 80, 81, 82, 83, 84, 85, 86, 87 | 204.8 |
| 4 | 88 | 10.1 |
| 5 | 89, 90 | 27.7 |
| 6 | 91 | 9.2 |

Failed assertion/error: The expression evaluated to a falsy value:

  assert.ok(sent.some(message => message.text?.includes('JobHunter summary') && message.text.includes('Discovered: 21')
. Backend submit POST requests: 1; confirmed submissions: 1.

Machine evidence: `tests/results/stage7.json`. Isolated schema: `stage7_7c2cac854134490f8197e854839153ab`. Artifacts: `C:\Users\r3d_flzp\Desktop\JobHunter n8n\data\test-stage7\stage7_7c2cac854134490f8197e854839153ab`.

Run: `node --env-file=.env scripts/test-stage-7.mjs --skip-bootstrap` (PowerShell: `.\scripts\test-stage-7.ps1 -SkipBootstrap`; shell: `./scripts/test-stage-7.sh --skip-bootstrap`). Real submissions stay disabled. Telegram transport is captured locally; real bot delivery and the separate post-Stage-7 real-discovery readiness gate remain unverified by this test.
