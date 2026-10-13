# Obscura application browser

Application sessions, public-board discovery and saved board contexts use Obscura
v0.2.4 through local Playwright CDP. No automatic Chromium fallback is used.
The Windows render release is pinned and SHA256 verified by
`scripts/install-obscura.ps1`. `scripts/obscura-service.mjs` runs it hidden on
127.0.0.1:9422 with one worker and at most four CDP connections. The supervisor
starts the engine; full stop includes its process tree.

File uploads use native CDP `DOM.setFileInputFiles`, not Playwright's in-memory
DataTransfer implementation, which is absent in this release. Application
upload path/hash checks remain enforced by browser-service. CDP is loopback only.

Text PDF generation remains a separate offline renderer. Obscura's raster PDF
export is not used for CVs because searchable, selectable text is required.

Live acceptance (2026-10-13): all 92 stopped applications were visited using
Obscura in two read-only sessions. 17 showed a matching current vacancy, 75
remained unknown due to access/identity failures, and none showed an explicit
closure. Detailed private evidence is in
`data/acceptance/obscura-stopped-revalidation.json`. Readability is not FIT.

Synthetic native checks cover actual file bytes, input events, screenshots and
cookie isolation. No real application is counted as submitted without site
confirmation and screenshot. An expired manual handoff is closed as superseded,
not recorded as a human answer or a solved CAPTCHA.

Automatic CAPTCHA code and owner settings are preserved. Agent-controlled
acceptance uses the separate manual-only browser entry point
`scripts/browser-controlled-validation.mjs`; it does not run the automatic solver.

## Live acceptance limitation

The AI Technician form was re-filled through Obscura with its existing CV and
verified profile. The user explicitly authorized omission of the optional city
field after Lever's searchLocations endpoint returned 403. Whole-form Gemma
review returned +. Submit did not produce a candidate request or site receipt.
The page remained at Analyzing resume, with no visible challenge. This is not a
successful end-to-end acceptance. The mass workers stay held for migration.

The compatibility layer implements the standard iframe sandbox PutForwards
setter without removing the attribute or replacing the native token list, and
adapts Playwright frame-owner lookup to observed iframe URLs. Synthetic checks
are not proof of complete browser compatibility. No Chromium fallback is used.

A subsequent isolated network-contract check found that both Playwright
route.fulfill and direct CDP Fetch.fulfillRequest were observed but did not
replace the loaded response in this build. Production connections now enforce
that contract before returning a browser. The current build fails with
OBSCURA_REQUEST_INTERCEPTION_NOT_VERIFIED. Migration is staged, not accepted for
production applications. Native NOT_DISPATCHED records are not conclusive until
request interception is trustworthy; ambiguous application outcomes stay blocked.
