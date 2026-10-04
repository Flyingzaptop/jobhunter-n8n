# Continuous discovery integration contract

The scheduler calls `runMarketDiscovery({repository, sourceIds, observer, signal})`
from `services/core/discovery-v2.mjs`. The function owns the PostgreSQL advisory
lock `jobhunter.market-discovery`; a simultaneous invocation throws
`DISCOVERY_ALREADY_RUNNING`. A worker must not acquire that same lock through a
different connection before calling the function. Discovery performs no model
inference or employer submissions.

Source state survives process restarts in `market_source_health.metadata`:

| Field | Meaning |
|---|---|
| `next_request_at` | Earliest next invocation; cooldown scans preserve this timestamp rather than extending it |
| `next_listing_page_url`, `next_listing_offset` | Published listing page and position within its durable observed vacancy snapshot |
| `listing_page_snapshot` | Exact observed URLs retained until that page's bounded detail processing completes |
| `listing_page_completed`, `cycle_completed` | Observed page/cycle end, never a claim that every vacancy on the internet was collected |
| `coverage_status`, `coverage_scope` | Explicit incremental progress and source scope |
| `feed_cursors` | Per-query published next URL, cumulative pages/records, cycle start/end and completion flag |

Praca.pl now starts from the broad public `/praca.html` listing rather than a
promoted homepage sample. Its observed Next link points to `/praca_2.html`.
The Wrocław source likewise follows the published `/wroclaw_2.html` link. OLX
follows its rendered `Dalej` link to `/praca/?page=2`. Page numbers are never
guessed. All adapters preserve their source identity and normal PostgreSQL
normalization/dedupe mappings.

Details are bounded per invocation. A source finishes its observed URL snapshot
before following the next published page, then returns to its root only after
the observed end of pagination. Praca/OLX continuation is due after 60 seconds;
completed-cycle refresh is due after one hour. Failed/access-blocked sources and
manual policy probes back off for one hour. Other sources retain their operator
specific minimum scan intervals, including the conservative public-feed limits.
Feed pagination continues from its stored cursor instead of repeatedly importing
only the first bounded pages. Completed query families wait for the remaining
families in the same source cycle before starting another source cycle.
Previously rejected exact Praca details receive up to two retries within their
current page snapshot before the next sweep. Published pagination URLs are
excluded from vacancy snapshots. A string-valued public employer declaration
such as `confidential` is retained as published, allowing anonymous real offers
without inventing an employer name.

The public-board fit path reverifies the exact current detail and structured
JobPosting identity, description and explicit validity. A valid future expiry
can establish `OPEN` using method `CURRENT_PUBLIC_BOARD_POSTING`. Missing expiry,
invalid identity, access challenges and ambiguous same-day date-only expiry
remain `UNKNOWN`. Explicit expiry/closed state is `CLOSED`; contradictory explicit
application deadlines remain `UNKNOWN`. Reverification refreshes stored content
and its hash. This method is distinct from an employer ATS verification.
The fit queue retries temporary verification transport failures after at least
five minutes with bounded exponential backoff. Challenges/unsupported verification
remain unverified and are checked no more than daily. Unchanged analysis receipts
skip model inference, while availability is still rechecked after one day.
Local and LM Studio analysis are classified as local provider work.

Actual bounded scan evidence: `tests/results/incremental-public-boards.json`.
The initial broad scan imported 13 Praca records (11 new; three malformed details
rejected) and two new OLX records. Both report `INCREMENTAL_SCAN_PENDING`, with
Praca offset 16 of its observed page snapshot and OLX offset 2. An actual dated
Praca detail reverified `OPEN`; evidence is
`tests/results/public-board-reverification.json`. These counts are current scan
evidence, not exhaustive platform coverage. Public listings can change during a
sweep and platforms may cap results; such limits cannot prove collection of all
existing vacancies.
