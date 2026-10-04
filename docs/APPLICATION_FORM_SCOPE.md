# Employer page application scope

`scopeApplicationForm(view)` narrows pages containing several visible forms to the uniquely identified application form. The identifying evidence is one required CV/resume upload on a multipart POST form and one matching application submit button. Talent-community fields and buttons are excluded. Multiple CV forms, missing submit scope, or unverified form metadata fail closed.

The helper preserves the original page fingerprint and raw field labels so durable questions and recovery continue to bind to the actual observed page. Call it before filling and after snapshots used for final review. Form-less SPA applications and pages with a single visible form retain their complete view.

This identifies form scope only. It grants no submit permission, consent, CAPTCHA handling, or authority to answer unknown questions. The existing browser write gate and preparation dry-run lock continue to control actions.

Validation: `node --test tests/application-form-scope.test.mjs`.
