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

The root task separately verified that Pracuj.pl is readable in the user's
existing ordinary Chrome profile. That does not establish equivalent access in
an empty headless context. OLX robots access remains a separate unresolved Node
policy-probe result; a readable headless sample does not silently change the
configured discovery adapter to operational.
