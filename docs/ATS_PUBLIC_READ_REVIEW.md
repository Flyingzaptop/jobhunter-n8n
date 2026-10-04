# Reviewed public ATS reads

The real Ashby application page initially showed zero fields because its normal
public form-schema reads use POST GraphQL. A local browser diagnostic identified
two operations on `https://jobs.ashbyhq.com/api/non-user-graphql`:
`ApiJobPosting` and `ApiOrganizationFromHostedJobsPageName`.

Only the exact observed query SHA-256 fingerprints in
`config/ats_public_read_queries.json` are accepted. Operation name, URL parameter,
public hostname/path, variable names and board/posting IDs are validated. Extra
candidate fields, alternate queries, mutations, authenticated endpoints and other
origins are rejected. An updated public query requires fresh review. No CAPTCHA
solver, clearance cookie, anti-detect browser or authentication bypass is used.

Actual repeat inspection reached **36 visible fields** on the same real posting.
This establishes public form-schema loading, not a suitable candidate match,
completed filling/uploading or a final-review PASS. No fields were filled and no
employer submission occurred in this diagnostic. Evidence is local
`tests/results/ats-request-diagnostics.json`.

The browser also identifies disabled fields and reviewed hidden resume inputs,
maintains hash/path/size checks for PDF selection, and redacts credentials in
request diagnostics. Preparation-only application execution checks actual form
values, mandatory answers, verified CV attachment hashes and employer declarations
before stopping under dry-run. Policies requiring human-authored content require
manual review rather than an automatically checked assertion.
