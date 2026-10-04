# Real market Discovery v2

Status: **PARTIAL**. Run c8f3bea7-190c-48c5-bf3d-c5527dc0beb9. Started 2026-10-03T20:11:58.159Z; completed 2026-10-03T20:18:04.098Z.

Real employer submissions: **0**. Public GET-only discovery and PostgreSQL normalization; no model inference, CV generation or form submission in this discovery report.

- Configured sources/capabilities: 152
- Platforms actually attempted: 27 (Pracuj.pl, OLX Praca, Just Join IT, RocketJobs.pl, No Fluff Jobs, LinkedIn Jobs, Indeed, Wellfound, Welcome to the Jungle, Remote OK, We Work Remotely, Remotive, Himalayas, Working Nomads, Jobgether, Y Combinator Jobs, EURES, EuroTechJobs, EU Startups Jobs, Arbeitnow, Jobicy, Bulldogjob, theprotocol.it, Greenhouse, Lever, Ashby, SmartRecruiters)
- Operational platforms in this run: 13 (Just Join IT, RocketJobs.pl, Remote OK, We Work Remotely, Remotive, Himalayas, Jobgether, Arbeitnow, Jobicy, Greenhouse, Lever, Ashby, SmartRecruiters)
- Employer boards scanned: 74
- Employer boards operational: 74
- Employer board endpoints attempted: 123; 74 returned a valid feed, 68 returned at least one vacancy, 6 valid feeds were empty. Failed board seeds are listed below.
- Distinct hiring-company strings observed: 877. These are source display-name strings, **not 877 independently verified legal entities**.
- Raw vacancies: 13737
- Unique vacancies in this run: 13707
- New vacancies: 13300
- Keyword-evidence vacancies: 9996; candidate-relevant vacancies: UNKNOWN until actual fit analysis.

The current catalog subsequently added one Jobgether query-matrix entry (153 entries now); the recorded broad scan used 152. No extra full-market scan is claimed.

| Mandatory platform | Actual status | Real vacancies in this run |
|---|---|---:|
| Pracuj.pl | ACCESS_BLOCKED — ordinary public robots GET HTTP406 | 0 |
| OLX Praca | ACCESS_BLOCKED — ordinary public robots GET HTTP403 | 0 |
| Just Join IT | OPERATIONAL — public sitemap and permitted offer HTML | 32 |
| RocketJobs.pl | OPERATIONAL — public sitemap and permitted offer HTML | 32 |
| No Fluff Jobs | MANUAL_DISCOVERY_FALLBACK — robots blocks API/posting paths | 0 |
| LinkedIn Jobs | USER_SESSION_REQUIRED / approved integration or manual discovery; unapproved scraping prohibited | 0 |

The five mandatory Polish platforms and LinkedIn are present in the architecture, but only two Polish platforms produced vacancies. This milestone does not pass mandatory full-source acceptance. The 27 attempted platforms include policy-only probes; the 13 operational platforms actually returned valid vacancy feeds/HTML. No protected endpoint was used to turn a blocked source into PASS.

Separate real query observability evidence: run `5dc19d19-539e-4a27-913f-a2df159aad91`, source `jobgether-query-matrix`, six documented broad/role/geography plans, 238 raw →237 unique vacancies, 201 new vacancies. The plans cover mechanical, robotics, Python/ML/data, research engineering and technical support, together with an unfiltered query. Query-specific results are **not added** to the 13,707 unique vacancies above; sets may overlap. Evidence: `tests/results/market-query-evidence-v2.json`, actual progress log `data/runtime/market-query-v2.out.log`. Source status OPERATIONAL, overall subset run PARTIAL because mandatory platform coverage is incomplete.

Role-family indexing hints (overlap is possible):

```json
{
  "AUTOMATION_ROBOTICS": 3634,
  "PYTHON_ML_DATA": 4998,
  "IT_SYSTEMS_SUPPORT": 3516,
  "UNCLASSIFIED": 3711,
  "MECHANICAL_RD": 6587,
  "CROSS_DISCIPLINARY": 752
}
```

Country distribution; unknown country is not inferred from city or remote label:

```json
{
  "PL": 58,
  "BE": 2,
  "UNKNOWN": 9804,
  "CH": 45,
  "CN": 7,
  "GB": 68,
  "VN": 1,
  "TW": 2,
  "US": 298,
  "SE": 12,
  "SG": 6,
  "AE": 6,
  "FR": 4,
  "CA": 2,
  "ID": 1,
  "KR": 5,
  "AU": 3,
  "IL": 2,
  "LT": 2,
  "NO": 2,
  "JP": 3,
  "ES": 3,
  "NL": 1,
  "DE": 1,
  "European Union": 25,
  "United States": 1512,
  "France": 43,
  "United Kingdom": 177,
  "Germany": 39,
  "Canada": 73,
  "Australia": 41,
  "Portugal": 2,
  "Singapore": 72,
  "Japan": 59,
  "Brazil": 17,
  "Ireland": 37,
  "India": 37,
  "Spain": 6,
  "South Korea": 20,
  "Sweden": 67,
  "Switzerland": 1,
  "USA": 427,
  "Philippines": 1,
  "Poland": 9,
  "United Arab Emirates": 12,
  "Mexico": 10,
  "Korea": 1,
  "Belgium": 1,
  "Netherlands": 7,
  "Argentina": 2,
  "Italy": 1,
  "Denmark": 2,
  "Saudi Arabia": 5,
  "Colombia": 2,
  "Chile": 1,
  "Serbia": 11,
  "Austria": 1,
  "UK": 2,
  "Qatar": 2,
  "cn": 5,
  "in": 26,
  "br": 10,
  "us": 37,
  "ar": 1,
  "mx": 8,
  "pt": 7,
  "ca": 96,
  "de": 37,
  "hu": 16,
  "ro": 11,
  "it": 9,
  "be": 1,
  "pl": 35,
  "vn": 19,
  "kr": 1,
  "fr": 269,
  "my": 3,
  "es": 6,
  "tr": 1,
  "se": 3,
  "at": 4,
  "th": 4,
  "jp": 2,
  "au": 1,
  "cr": 1,
  "pe": 1,
  "nl": 1,
  "gb": 10,
  "ch": 5,
  "gr": 1,
  "cl": 2,
  "ua": 2,
  "bg": 1,
  "sg": 1,
  "ma": 7
}
```

Work-format distribution:

```json
{
  "REMOTE": 2984,
  "UNKNOWN": 8583,
  "ONSITE": 574,
  "HYBRID": 1566
}
```

| Source / employer | Observed status | Raw | Unique | Requests/pages | Error |
|---|---|---:|---:|---:|---|
| Pracuj.pl / pracuj | ACCESS_BLOCKED | 0 | 0 | 0 | SOURCE_HTTP_406 |
| OLX Praca / olx | ACCESS_BLOCKED | 0 | 0 | 0 | SOURCE_HTTP_403 |
| Just Join IT / justjoin | OPERATIONAL | 32 | 31 | 34 |  |
| RocketJobs.pl / rocketjobs | OPERATIONAL | 32 | 27 | 34 |  |
| No Fluff Jobs / nofluff | MANUAL_DISCOVERY_FALLBACK | 0 | 0 | 1 |  |
| LinkedIn Jobs / linkedin | USER_SESSION_REQUIRED | 0 | 0 | 1 |  |
| Indeed / indeed | MANUAL_DISCOVERY_FALLBACK | 0 | 0 | 1 |  |
| Wellfound / wellfound | MANUAL_DISCOVERY_FALLBACK | 0 | 0 | 1 |  |
| Welcome to the Jungle / welcome-jungle | MANUAL_DISCOVERY_FALLBACK | 0 | 0 | 1 |  |
| Remote OK / remoteok | OPERATIONAL | 99 | 98 | 1 |  |
| We Work Remotely / wwr | OPERATIONAL | 89 | 87 | 1 |  |
| Remotive / remotive | OPERATIONAL | 16 | 16 | 1 |  |
| Himalayas / himalayas | OPERATIONAL | 240 | 240 | 12 |  |
| Working Nomads / workingnomads | MANUAL_DISCOVERY_FALLBACK | 0 | 0 | 1 |  |
| Jobgether / jobgether | OPERATIONAL | 135 | 135 | 6 |  |
| Y Combinator Jobs / yc-jobs | MANUAL_DISCOVERY_FALLBACK | 0 | 0 | 1 |  |
| EURES / eures | MANUAL_DISCOVERY_FALLBACK | 0 | 0 | 1 |  |
| EuroTechJobs / eurotechjobs | MANUAL_DISCOVERY_FALLBACK | 0 | 0 | 1 |  |
| EU Startups Jobs / eu-startups | MANUAL_DISCOVERY_FALLBACK | 0 | 0 | 1 |  |
| Arbeitnow / arbeitnow | OPERATIONAL | 750 | 729 | 3 |  |
| Jobicy / jobicy | OPERATIONAL | 300 | 300 | 3 |  |
| Bulldogjob / bulldogjob | MANUAL_DISCOVERY_FALLBACK | 0 | 0 | 1 |  |
| theprotocol.it / theprotocol | MANUAL_DISCOVERY_FALLBACK | 0 | 0 | 1 |  |
| Greenhouse / Canonical | OPERATIONAL | 310 | 310 | 1 |  |
| Greenhouse / GitLab | OPERATIONAL | 211 | 211 | 1 |  |
| Greenhouse / Datadog | OPERATIONAL | 445 | 445 | 1 |  |
| Greenhouse / Cloudflare | OPERATIONAL | 405 | 405 | 1 |  |
| Greenhouse / SpaceX | FAILED | 0 | 0 | 0 | RESPONSE_TOO_LARGE |
| Greenhouse / Anduril Industries | FAILED | 0 | 0 | 0 | RESPONSE_TOO_LARGE |
| Greenhouse / Zipline | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / Figure AI | OPERATIONAL | 97 | 97 | 1 |  |
| Greenhouse / Agility Robotics | OPERATIONAL | 79 | 79 | 1 |  |
| Greenhouse / Skydio | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / Shield AI | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / Formlabs | OPERATIONAL | 232 | 232 | 1 |  |
| Greenhouse / Relativity Space | OPERATIONAL | 350 | 350 | 1 |  |
| Greenhouse / Rocket Lab | OPERATIONAL | 569 | 569 | 1 |  |
| Greenhouse / Planet Labs | OPERATIONAL | 119 | 119 | 1 |  |
| Greenhouse / Astranis | OPERATIONAL | 173 | 173 | 1 |  |
| Greenhouse / Lumafield | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / Verkada | OPERATIONAL | 307 | 307 | 1 |  |
| Greenhouse / Aurora Innovation | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / Cruise | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / Rivian | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / Neuralink | OPERATIONAL | 82 | 82 | 1 |  |
| Greenhouse / Nuro | OPERATIONAL | 102 | 102 | 1 |  |
| Greenhouse / Samsara | OPERATIONAL | 246 | 246 | 1 |  |
| Greenhouse / Applied Intuition | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / Waymo | OPERATIONAL | 366 | 366 | 1 |  |
| Greenhouse / Zoox | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / Robinhood | OPERATIONAL | 162 | 162 | 1 |  |
| Greenhouse / Stripe | OPERATIONAL | 716 | 716 | 1 |  |
| Greenhouse / Coinbase | OPERATIONAL | 229 | 229 | 1 |  |
| Greenhouse / Discord | OPERATIONAL | 51 | 51 | 1 |  |
| Greenhouse / Reddit | OPERATIONAL | 152 | 152 | 1 |  |
| Greenhouse / Dropbox | OPERATIONAL | 39 | 39 | 1 |  |
| Greenhouse / Duolingo | OPERATIONAL | 59 | 59 | 1 |  |
| Greenhouse / Elastic | OPERATIONAL | 394 | 394 | 1 |  |
| Greenhouse / Grafana Labs | OPERATIONAL | 121 | 121 | 1 |  |
| Greenhouse / HashiCorp | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / Confluent | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / Cockroach Labs | OPERATIONAL | 19 | 19 | 1 |  |
| Greenhouse / Databricks | OPERATIONAL | 886 | 886 | 1 |  |
| Greenhouse / Snowflake | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / dbt Labs | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / Hugging Face | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / Anthropic | OPERATIONAL | 640 | 640 | 1 |  |
| Greenhouse / Scale AI | OPERATIONAL | 192 | 192 | 1 |  |
| Greenhouse / Runway | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / ElevenLabs | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / Google DeepMind | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / Unity | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / Epic Games | OPERATIONAL | 147 | 147 | 1 |  |
| Greenhouse / Cloud Imperium Games | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / CD PROJEKT RED | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / SentinelOne | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Greenhouse / Affirm | OPERATIONAL | 189 | 189 | 1 |  |
| Greenhouse / Remote | OPERATIONAL | 2 | 2 | 1 |  |
| Greenhouse / Automattic | OPERATIONAL | 14 | 14 | 1 |  |
| Lever / RIVR | OPERATIONAL | 35 | 35 | 1 |  |
| Lever / Spotify | OPERATIONAL | 82 | 82 | 1 |  |
| Lever / Netflix | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Palantir | OPERATIONAL | 319 | 319 | 1 |  |
| Lever / Boston Dynamics | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Intrinsic | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / 1X Technologies | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / ANYbotics | OPERATIONAL | 24 | 24 | 1 |  |
| Lever / Auterion | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Quantinuum | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Rigetti | OPERATIONAL | 16 | 16 | 1 |  |
| Lever / IonQ | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Cohere | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Mistral AI | OPERATIONAL | 0 | 0 | 1 |  |
| Lever / Perplexity | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Weights & Biases | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Postman | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Linear | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Volta | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Welocalize | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Plaid | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Atlassian | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Canva | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Ledger | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Complexio | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Improbable | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Roblox | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Lever / Hudl | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Ashby / Ashby | OPERATIONAL | 62 | 62 | 1 |  |
| Ashby / OpenAI | OPERATIONAL | 828 | 828 | 1 |  |
| Ashby / Notion | OPERATIONAL | 137 | 137 | 1 |  |
| Ashby / Ramp | OPERATIONAL | 157 | 157 | 1 |  |
| Ashby / Deel | OPERATIONAL | 0 | 0 | 1 |  |
| Ashby / Linear | OPERATIONAL | 30 | 30 | 1 |  |
| Ashby / Vercel | OPERATIONAL | 0 | 0 | 1 |  |
| Ashby / Replit | OPERATIONAL | 72 | 72 | 1 |  |
| Ashby / Cursor | OPERATIONAL | 132 | 132 | 1 |  |
| Ashby / Quora | OPERATIONAL | 5 | 5 | 1 |  |
| Ashby / ElevenLabs | OPERATIONAL | 169 | 169 | 1 |  |
| Ashby / Cohere | OPERATIONAL | 137 | 137 | 1 |  |
| Ashby / Perplexity | OPERATIONAL | 127 | 127 | 1 |  |
| Ashby / Mistral AI | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Ashby / Supabase | OPERATIONAL | 48 | 48 | 1 |  |
| Ashby / Neon | OPERATIONAL | 4 | 4 | 1 |  |
| Ashby / Railway | OPERATIONAL | 8 | 8 | 1 |  |
| Ashby / Render | OPERATIONAL | 40 | 40 | 1 |  |
| Ashby / Modal | OPERATIONAL | 38 | 38 | 1 |  |
| Ashby / Together AI | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Ashby / Baseten | OPERATIONAL | 105 | 105 | 1 |  |
| Ashby / vLLM | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| Ashby / Poolside | OPERATIONAL | 2 | 2 | 1 |  |
| Ashby / Harvey | OPERATIONAL | 326 | 326 | 1 |  |
| Ashby / Decagon | OPERATIONAL | 148 | 148 | 1 |  |
| Ashby / Distyl AI | OPERATIONAL | 23 | 23 | 1 |  |
| Ashby / Cognition | OPERATIONAL | 103 | 103 | 1 |  |
| Ashby / Pylon | OPERATIONAL | 18 | 18 | 1 |  |
| Ashby / Dust | OPERATIONAL | 23 | 23 | 1 |  |
| Ashby / Lovable | OPERATIONAL | 77 | 77 | 1 |  |
| Ashby / Remote | FAILED | 0 | 0 | 0 | SOURCE_HTTP_404 |
| SmartRecruiters / Bosch Group | OPERATIONAL | 200 | 200 | 2 |  |
| SmartRecruiters / Siemens | OPERATIONAL | 0 | 0 | 1 |  |
| SmartRecruiters / Ubisoft | OPERATIONAL | 200 | 200 | 2 |  |
| SmartRecruiters / CD PROJEKT RED | OPERATIONAL | 43 | 43 | 1 |  |
| SmartRecruiters / ALTEN | OPERATIONAL | 200 | 200 | 2 |  |
| SmartRecruiters / SEGULA Technologies | OPERATIONAL | 0 | 0 | 1 |  |
| SmartRecruiters / ABB Group | OPERATIONAL | 0 | 0 | 1 |  |
| SmartRecruiters / SmartRecruiters | OPERATIONAL | 1 | 1 | 1 |  |
| Workday / workday | AUTH_REQUIRED | 0 | 0 | 0 | SOURCE_DISABLED |
| Teamtailor / teamtailor | AUTH_REQUIRED | 0 | 0 | 0 | SOURCE_DISABLED |
| SuccessFactors / successfactors | AUTH_REQUIRED | 0 | 0 | 0 | SOURCE_DISABLED |
| Workable / workable | AUTH_REQUIRED | 0 | 0 | 0 | SOURCE_DISABLED |
| Recruitee / recruitee | AUTH_REQUIRED | 0 | 0 | 0 | SOURCE_DISABLED |
| Personio / personio | AUTH_REQUIRED | 0 | 0 | 0 | SOURCE_DISABLED |

- Catalog seeds are counted as operational only after a successful live fetch; failed/empty boards remain visible.
- Role families are broad keyword indexing hints, not model fit or candidate eligibility. relevant_vacancies is unknown until analysis.
- Aggregate feed publication does not verify an employer vacancy is currently open. Reverification is mandatory before CV/application.
- Paginated and sitemap sources have bounded per-run limits; truncated sources are explicit. No global-market exhaustiveness claim.
- LinkedIn and blocked Polish sources require authorized integration or manual discovery. No login/access restriction bypass.

Detailed live evidence: tests/results/market-discovery-v2.json; access-policy evidence: tests/results/market-access-audit.json. Source access documentation: docs/MARKET_SOURCE_ACCESS.md. Mock/regression unit tests are separate and are never counted as real market evidence.

Run: `node --env-file=.env scripts/discovery-market.mjs`. Optional bounded subset: `--sources=justjoin,rocketjobs,greenhouse-canonical`; optional `--max-sources=10`.
