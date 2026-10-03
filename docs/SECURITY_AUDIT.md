# Security audit, 2026-10-03

Runtime: n8n2.41.6 with PostgreSQL. `n8n audit` was executed using the configured
native installation; raw local report retained in ignored `data/n8n-audit.txt`.

Findings:
- The internal header credential is unused by active workflows: expected while
  all production workflows remain inactive during acceptance. It must stay for
  authenticated stage calls.
- HTTP Request nodes are reported as risky official nodes. Their URLs are fixed
  to the internal core service; they do not evaluate vacancy instructions.
- Community packages and public API were enabled by defaults. Bootstrap/Compose
  explicitly disable these features for this project; a restart applies changes.

Root service dependency audit (`npm audit --omit=dev`) reported0 known
vulnerabilities. This does not establish that n8n's dependency tree is free of
vulnerabilities. Browser boundary tests exercised unsafe schemes, private DNS,
IPv4/IPv6, redirects, path restriction, upload hash and final-action gating.
No real submission is enabled. Production Telegram and credentials remain
unconfigured; endpoint authentication is tested with isolated fixture tokens.
