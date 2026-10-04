# Public LinkedIn pagination evidence

Observed 2026-10-04 22:12 UTC using ordinary public HTTP GET, with no account credentials or application submission.

Endpoint: `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`
Query: `keywords=python&location=European%20Union&f_WT=2`.

| Offset | HTTP | Distinct job IDs | Response characters |
|---|---|---|---|
| 0 | 200 | 4473719562, 4418974011, 4471438645, 4468187178, 4472732626, 4465078664, 4467614614, 4274107088, 4473226088, 4408794926 | 30173 |
| 10 | 200 | 4463810981, 4467502615, 4472178027, 4391871456, 4466472680, 4460741246, 4468602519, 4465052165, 4466216989, 4465694641 | 30507 |

The second request returned ten different postings. This proves public search and this pagination transition only. It does not prove complete market coverage, Poland work eligibility, Easy Apply, CV upload or a prepared application. Integrated collection remains separately tracked by source receipts; a simultaneous manual run was refused with `DISCOVERY_ALREADY_RUNNING` while the continuous collector owned discovery.

Repeated pages and the guest result window cap remain incomplete states. Only an empty successful feed response establishes the observed end of this query window.
