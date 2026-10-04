# Ordinary headless public-board check

Run `node scripts/headless-board-probe.mjs --max-details=2` from the project root.
Optional bounded subset: `--sources=olx`; detail limit is 0–5.

This launches actual Playwright Chromium in headless mode, with GPU disabled and
a separate empty browser context for each platform. It uses the standard browser
user agent and imports no cookies, profiles, authentication or proxy settings.
Only GET/HEAD requests are transmitted. It does not interact with sign-in,
application forms or CAPTCHA/security challenges. A detected challenge stops
that source/detail. No model inference is performed.

Actual check on 2026-10-04:

| Platform | Headless listing result | Actual collected evidence |
|---|---|---|
| Pracuj.pl | HTTP 403, `Just a moment...`, challenge detected | Zero vacancy links/details; empty isolated headless context cannot claim success |
| OLX Praca | HTTP 200, public listing readable | 52 unique current vacancy links; two exact public details each HTTP 200 with one structured JobPosting |

Machine evidence is saved to `tests/results/headless-board-probe.json`, including
the actual public URLs and collected JobPosting objects. Console output reports
counts and statuses without printing full vacancy bodies. The command collects
evidence only; it does not import into PostgreSQL or claim full platform coverage.

The main discovery adapter now uses the same reusable browser collector for OLX:
`node --env-file=.env scripts/discovery-market.mjs --sources=olx`. It imports two
bounded current public JobPosting details per scan into PostgreSQL, records a
rotating listing offset and applies the normal source provenance/dedupe pipeline.
The actual initial adapter run imported two new unique vacancies with status
OPERATIONAL. Its separate evidence is `tests/results/olx-headless-discovery.json`.
An inaccessible robots endpoint remains visibly recorded as
`UNKNOWN_PUBLIC_ROBOTS_UNAVAILABLE` / `SOURCE_HTTP_403`; it does not establish
that the separately readable public listing is prohibited. Usable published
robots restrictions are respected before fetching a detail. Private API and
authentication endpoint requests are blocked along with all non-GET/HEAD methods.

The root task separately verified that Pracuj.pl is readable in the user's
existing ordinary Chrome profile. That does not establish equivalent access in
an empty headless context. OLX robots access remains a separate unresolved Node
policy-probe result. Operational status now comes from an actual successful
bounded adapter run rather than inferred source permission or catalog presence.
