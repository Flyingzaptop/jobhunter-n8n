# Praca.pl native application: live evidence

Real vacancy: [Technik utrzymania ruchu — mechanik / elektryk / automatyk](https://www.praca.pl/technik-utrzymania-ruchu-mechanik-elektryk-automatyk_11537866.html), NES Fircroft, Wrocław.

Observed on 5 October 2026, Europe/Warsaw. Application `8eaf88f9-6929-4aa5-9be9-511b71d1657d`; candidate-specific CV bound to job `08149b1a-ae54-5639-b56b-d2405b31a79c`.

- The public posting identity and visible Polish application link were verified live. The internal application form opened at `/apply/internal/11537866.html`.
- Actual name, surname and email fields were filled from the confirmed private candidate profile. The selected “with CV” radio alternative satisfied its group; the obsolete question about the “without CV” alternative was closed without inventing a user answer.
- The cookie dialog was examined live: its customization action opens a second view, whose rejection control is not a normal HTML button. The adapter uses the observed cookie-specific labels, rejects optional cookies and leaves application consents untouched.
- A separate controlled session of the same real form uploaded the same approved PDF. `POST /applying/upload-file` uses JSON `{file:{file:<PDF data URI>,fileName:<approved name>},isCv:true}`. Authorization checks its exact structure, filename and decoded SHA-256.
- The real server returned HTTP 200, `status: success`, a matching filename and a positive numeric file ID. Browser evidence recorded `SERVER_UPLOAD_RECEIPT`; no upload request was blocked in the successful rehearsal. File IDs and download URLs remain in ignored private receipts.
- The actual final control is a native BUTTON with the label “WYŚLIJ”. It is recognized as final Submit; it was **not clicked**.

The primary application is waiting for explicit consent to the required regulation/account-creation checkbox. Optional marketing and sharing CV with other employers remain unchecked. Its earlier failed file selection needs to be retried through the deployed upload adapter; successful upload in the separate rehearsal does not by itself mark that primary application ready.

This is partial native-form acceptance, not a submitted application or completed four-source acceptance. Current exclusions: pending mandatory consent, final review, restoration/revalidation of the prepared form, the remaining source routes, and the final two-hour soak. Real employer submissions in these runs: **0**.

Reproducible guarded upload-only probe: `node --env-file=.env scripts/probe-praca-upload.mjs 8eaf88f9-6929-4aa5-9be9-511b71d1657d`. It validates the active candidate and current CV evidence, uses an isolated loopback browser service, preserves private receipts under `data/browser-upload-probes/`, and never performs Submit.
