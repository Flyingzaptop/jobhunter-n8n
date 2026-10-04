# Manual CAPTCHA handoff

Application filling persists a per-application manual CAPTCHA question and `captcha_handoffs` outbox record. It returns immediately without making a Telegram request or pausing the global pipeline. Waiting for a human is specific to that application.

`enqueueCaptchaHandoff({repository,applicationId,sessionId,snapshot,chatId,dashboardOrigin})` requires a current observed CAPTCHA and a matching `MANUAL_TAKEOVER / INTERACTIVE_CAPTCHA` or `CAPTCHA_WAIT` state. It deduplicates the application/session/form fingerprint. Factual-answer endpoints cannot accept CAPTCHA codes for this manual question.

Run the independent notification worker with:

```powershell
node --env-file=.env scripts/captcha-handoff-worker.mjs
```

For a bounded check, add `--once`. The worker respects the global user pause. Configure the existing `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_CHAT_ID` locally. Without either, the durable record becomes `WAITING_CONFIGURATION`; the dashboard manual question and employer URL remain available. Delivery is never reported as sent without a Telegram message ID.

The authenticated browser-service `captcha-image` operation captures only a visible, bounded CAPTCHA element, masks form controls, and returns an in-memory PNG. It has no full-page fallback and performs no clicks, OCR, token reads, or challenge solving. The delivery worker sends this crop when available, otherwise an employer/dashboard link. Started or ambiguous sends are never blindly retried. A human should inspect `DELIVERY_UNKNOWN` before authorizing another notification.

The authenticated `/manual-captcha/:applicationId` page provides a dedicated human interface in the existing browser session. The user explicitly confirms that they perform the interaction themselves, then clicks the cropped CAPTCHA image. Each pointer action consumes one fresh view ID bound to a trusted provider frame, its current rectangle and a 30-second expiry. No generic selectors, full-page clicks or application Submit controls are exposed.

Only narrowly reviewed reCAPTCHA or hCaptcha verification POST destinations are allowed during the 15 seconds following a valid human pointer action. Candidate-data writes remain gated. Production trusts explicit provider HTTPS hosts and frame paths; localhost is recognized only by the isolated mock network configuration.

Resume requires a fresh observed trusted provider checkbox with `aria-checked=true` and a protected response-presence boolean. The response token itself is omitted from snapshots and is never returned to the user, logged or saved in application state. Verified resume changes the existing application to `FILLING` in the same session and releases its continuous preparation queue record. This is a manual handoff resolution audit, not a fabricated factual-answer receipt, and enables no submission.

Invisible widgets without a visible trusted frame, unsupported provider variants, keyboard/audio challenges and missing verification evidence fail closed. The current provider interaction has been exercised with an isolated browser fixture; completing a real provider challenge remains the user's task. The ordinary dashboard Browser page remains an observer, and an employer link opens a separate context.

Validation covers cropped Playwright capture, per-application isolation, missing configuration, once-only concurrent delivery, stale observations, privacy and ambiguous delivery.

Telegram captions include company, role, a short request ID unique within the active queue, queue position and total pending real requests. `/captcha_queue` and `/start` show the queue. A reply must target the exact message ID in the authorized chat and still-current application/session/handoff. Replies are audited without their plaintext. `готово` requests fresh provider verification; it never supplies a token or certifies completion. Durable Telegram update receipts prevent duplicate dispatch. The manual page lists the same active-profile queue.

An invisible preloaded reCAPTCHA anchor with no visible checkbox is not an outstanding challenge. Browser snapshots expose a redacted `captcha_observation`; a visible unchecked checkbox or active challenge still pauses that application. The bounded `recover-preloaded-captcha.mjs` command is restricted to the reviewed Linear application and requires current verified source/CV/profile evidence, untouched state, and a fresh observation of the inactive invisible widget. Its audit source is `SYSTEM_BUG_RECOVERY`, with `human_captcha_solved=false`.

Explicit Telegram transport tests use `scripts/captcha-transport-test.mjs --transport-test --count 2`. They render two labelled synthetic images and store only salted expected-code hashes, expiry, message IDs and delivery metadata. Reply codes are correlated to their own photo and processed through the durable Telegram ledger. Transport proof is stored separately from employers, real CAPTCHA queues, factual answers and application verification. It never changes an application or permits Submit.

Private Telegram CAPTCHA links carry a one-use access token in the URL fragment, not the query string. Only a salted hash is stored. The link expires after 30 minutes and exchanges once for an HttpOnly, SameSite=Strict cookie plus CSRF protection bound to that current handoff, application, profile and browser session. The fragment is removed from browser history immediately. Issuing a replacement revokes earlier unused links; resolving the handoff revokes its access grants.

The public manual-page shell contains no employer/application data. Provider images and pointer/resume actions require either ordinary dashboard authentication or this exact CAPTCHA-only cookie. CAPTCHA access does not authenticate general dashboard APIs, other applications, browser controls or Submit. The normal dashboard password remains in place; a valid private Telegram CAPTCHA link needs no dashboard password. Expired, replayed and stale links require a new private link from `/captcha_queue`.
