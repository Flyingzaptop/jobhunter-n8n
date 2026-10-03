# Queue handoff verification

OVERALL: PASS

Five distinct actual n8n workflows link discovery through application processing using Execute Sub-workflow and persisted isolated queues. Diagnostic child calls wait for completion to verify the entire chain; production calls are asynchronous and have periodic backlog triggers. n8n 2.x requires published child versions; only isolated test copies are published and unpublished during this check. Empty source queues avoid model/browser/application actions.

Executions: 153, 154, 155, 156, 157. 

Run: node --env-file=.env scripts/test-queue-handoff.mjs. Evidence: tests/results/queue-handoff.json.
