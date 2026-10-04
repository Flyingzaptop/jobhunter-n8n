# Discovery v2 source access and scope

Checked 2026-10-04 for Praca.pl, Pracuj.pl and OLX; remaining source audit 2026-10-03. This is real public job-market discovery. The old mock board
remains regression-only. Discovery performs GET requests only; final employer
submission remains disabled. No user cookies, passwords, CAPTCHA solutions,
undocumented protected search APIs or user-agent impersonation are used.

`config/market_sources.yaml` contains 123 independently configurable employer
board seeds and Polish/global platforms. A seed is **not** operational evidence:
live successful source runs and samples in PostgreSQL determine actual coverage.
Wrong/retired board tokens remain visible as FAILED/404, not invented vacancies.

## Access decisions

| Source | Access used / restriction | Current implementation |
|---|---|---|
| Praca.pl | Ordinary robots, homepage, Wrocław listing and job detail GET succeed; public job paths allowed, account/apply/API paths excluded | Dynamic same-origin current vacancy links → bounded JobPosting details with persistent scan offset; source and Wrocław source configured |
| Pracuj.pl | Fresh ordinary robots GET returns 200 and advertises current-offers sitemap; Node search and advertised sitemap GET return 403 challenge; ordinary existing-profile Chrome public listing loads without CAPTCHA | HTTP adapter remains unavailable; browser public listing is readable and must be distinguished from a universal site ban or the Node transport failure |
| OLX Praca | Ordinary listing GET returns 200 but robots GET returns 403; public listing also readable through web search tooling | Node adapter remains policy/manual fallback with unknown usable policy; zero automatic imports, public readability distinguished from implemented discovery |
| Just Join IT | robots advertises active-jobs sitemap; individual job-offer HTML allowed; `/api/` disallowed | Public sitemap → bounded JobPosting HTML extraction; no internal API |
| RocketJobs.pl | robots advertises active-jobs sitemap; individual offers allowed; `/api/` disallowed | Public sitemap → bounded JobPosting HTML extraction; no internal API |
| No Fluff Jobs | robots disallows `/api/`, `/posting/` and country-prefixed posting paths | MANUAL_DISCOVERY_FALLBACK; no prohibited listing crawl |
| LinkedIn Jobs | wildcard robots forbids crawling; agreement prohibits unapproved scraping and copying cookies | USER_SESSION_REQUIRED / manual or approved integration; no automatic login or scraping even with ordinary session cookies |
| Indeed, Wellfound, Welcome to the Jungle | No approved documented vacancy feed configured | Policy probe only, manual fallback; no operational claim |
| Working Nomads, YC Jobs, EURES, EuroTechJobs, EU Startups | Public policy checked; automatic vacancy adapter not implemented | Policy probe only, manual fallback; no operational claim |
| Remote OK | Public API contains its own link-back/source attribution terms | GET JSON; source link retained, metadata/legal row excluded |
| We Work Remotely | Official public RSS explicitly permits use with attribution | GET RSS; company/title split and original listing retained |
| Remotive | Official public API; recommends max four requests/day; listings delayed 24h | One broad GET, persistent 6h minimum scan interval, attribution retained |
| Himalayas | Official public JSON API; max 20/page; opaque cursor | GET with cursor, bounded pages, attribution/source URL retained |
| Jobgether | Official AI-agent GET API, robots explicitly permits `/astroapi/ai/jobs.json?*` | GET-only documented search families and bounded page pagination; listings retained; description absence visible |
| Arbeitnow | Operator documents no-key European job API | GET, bounded pagination, original listing retained |
| Jobicy | Official public no-key API with cursor and fair-use guidance | GET, bounded cursor pagination and conservative interval |
| Greenhouse | Documented public GET endpoints require no authentication | Board list/content GET; fresh published feed verifies OPEN; singular GET reverifies before downstream use |
| Lever | Official published-postings REST API; documentation permits third-party access to published postings | Public board list and singular GET; global/EU hosting configurable |
| Ashby | Documented public Job Postings API | Board GET; unlisted entries excluded; fresh snapshot reverification |
| SmartRecruiters | Documented public Posting API | Public company postings GET; listing descriptions absent until separate official detail GET |
| Workday, SuccessFactors, Workable, Teamtailor APIs | Account/site-specific permission or credentials needed; no approved account API integration supplied | Disabled/auth/manual capability visible |
| Teamtailor actual public career index/details | Public robots permits job pages; three exact currently listed JobPosting details fetched | Bounded public HTML discovery and fresh listing/detail reverification; no account API |
| NVIDIA Workday actual public target | Ordinary robots GET returns HTML shell; vacancy HTML lacks JobPosting | MANUAL_DISCOVERY_FALLBACK / INVALID_ROBOTS_PAYLOAD, zero vacancy imports; no protected API fallback |
| Recruitee | Official documentation now requires Careers API token, enforcement deadline February 2027 | AUTH_REQUIRED; do not rely on older third-party no-auth descriptions |
| Personio | Employer opt-in XML feed requires known approved tenant | Visible unsupported/manual capability until configured |

The sitemap redirects for JJIT/RocketJobs go to `public.justjoin.com`. That exact
host was observed from the public redirect and explicitly added to the allowlist.
Each individual offer is checked against the platform's robots rules. A prohibited
URL or access-block response stops that source; there is no alternate hidden API.

The bounded Teamtailor/NVIDIA extension is documented separately in
`docs/REAL_ATS_DISCOVERY_EXTENSION.md`. Public HTML permission is distinct from
an authenticated account API capability; robots must return a usable policy.

Polish mandatory-source and LinkedIn acceptance remains **PARTIAL** while these
restrictions prevent collecting all mandatory sources. Catalog breadth or ATS
counts never substitute for this acceptance requirement.

## Primary sources

- [Greenhouse public GET authentication and Job Board API](https://docs.greenhouse.io/job-board.html)
- [Lever official Postings API](https://github.com/lever/postings-api)
- [Ashby public Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api)
- [SmartRecruiters Posting API](https://developers.smartrecruiters.com/docs/posting-api)
- [LinkedIn agreement, section 8.2](https://www.linkedin.com/legal/user-agreement)
- [LinkedIn robots](https://www.linkedin.com/robots.txt)
- [Pracuj robots](https://www.pracuj.pl/robots.txt)
- [OLX robots](https://www.olx.pl/robots.txt)
- [JJIT robots](https://justjoin.it/robots.txt)
- [RocketJobs robots](https://rocketjobs.pl/robots.txt)
- [No Fluff Jobs robots](https://nofluffjobs.com/robots.txt)
- [Remote OK API and attribution terms](https://remoteok.com/api)
- [WWR public RSS permission](https://weworkremotely.com/remote-job-rss-feed)
- [Remotive official API and rate guidance](https://github.com/remotive-com/remote-jobs-api)
- [Himalayas API and attribution rules](https://himalayas.app/api)
- [Jobgether official AI search API](https://jobgether.com/astroapi/ai/jobs/docs)
- [Arbeitnow operator's API announcement](https://www.arbeitnow.com/blog/job-board-api)
- [Jobicy official API](https://github.com/Jobicy/remote-jobs-api)
- [Recruitee official authentication change](https://docs.recruitee.com/reference/authentication-1)

Raw policy evidence is in ignored `tests/results/market-access-audit.json`; live
source-run evidence is in PostgreSQL and `tests/results/market-discovery-v2.json`.
Reported errors exclude arbitrary server bodies/headers and secrets.

## Search, persistence and downstream freshness

`config/search_queries_v2.yaml` contains English/Polish role families and all
requested Poland/Europe/worldwide geography priorities. ATS feeds fetch every
published role without title prefiltering. Jobgether issues documented broad
role-family searches alongside an unfiltered query; query/geography/page appear
in actual observer events and source metrics. Sitemap scans have persistent
offsets, retaining all discovered URLs as a next-run queue rather than dropping
nonmatching titles. Keyword family tags are indexing hints only; candidate fit
and Poland employment eligibility must come from the fit engine.

Vacancies are normalized and deduplicated using the existing canonical URL,
ATS identity and conservative content-confidence policy. An indexed candidate
lookup makes large catalogs practical without loosening dedupe. Every discovered
board origin persists in `job_sources`. `source_url`, canonical URL and application
URL remain separate. A remote label never implies permission to work from Poland.

The source catalog joins `market_source_health` for the dashboard: latest status,
last success/failure/run, returned/unique counts, latency, error rate, capabilities,
auth requirement and scan cursors. Every source run is append-only and references
a discovery run. `relevant_jobs` stays NULL until actual fit analysis.

Fresh official ATS feed publication records `last_verified_open_at`. Aggregator
publication remains UNKNOWN for employer availability. `reverifyMarketJob` uses
official singular posting GETs or the Ashby current board snapshot and updates
OPEN/CLOSED and closure timestamps; SmartRecruiters detail sections are hydrated
and persisted on demand, and its refreshed job is returned as `verification.job`.
Unsupported or inaccessible revalidation returns UNKNOWN and must
block CV/application. CV and application stages must each call revalidation.

Sitemap/feed maximum pages and truncated results are reported explicitly. A
bounded first scan is not exhaustive market coverage. Entire source catalogs can
run repeatedly without exceeding persisted source minimum scan intervals.

## Interfaces and verification

`runMarketDiscovery({repository, observer, registryPath, sourceIds, maxSources,
signal})` returns actual run/source/distribution evidence. Async observer events
include run ID, platform, query, geography, page/cursor, current counts, latency,
status and error code. `listMarketSourceHealth(repository)` is the Sources API
data provider. Existing `discoverSources` and normalization APIs are retained.

Run `node --env-file=.env scripts/discovery-market.mjs` for real PostgreSQL
discovery. Unit tests use injected transport payloads to verify robots, forbidden
access, source mapping and conservative dedupe; they are regression evidence,
not real-world acceptance.
