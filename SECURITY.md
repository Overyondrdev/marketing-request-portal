# Security

The portal holds internal Yondr briefs and files. Report anything that could expose them **privately**, never in a
public issue, pull request or channel.

## Reporting a vulnerability

1. Open the repository's **Security** tab on GitHub.
2. Choose **Report a vulnerability** (GitHub private vulnerability reporting).
3. Describe the problem, how to reproduce it and what it could expose.

Only the repository owners see the report. We aim to acknowledge it within 3 working days. Please don't access,
change or keep data that isn't yours while testing.

**Scope:** `requests.overyondrdev.com` and this repository's code and workflows. Every `*.overyondrdev.com` host is
private behind the Yondr Google sign-in, so any way in without a valid sign-in is in scope. Third-party services
(Google, Cloudflare, Resend, Slack, GitHub) are out of scope; report to them directly.

## How the portal is protected

- **Sign-in:** the Yondr Google sign-in (`auth.overyondrdev.com`): only verified `@overyondr.com` Google Workspace
  accounts. It sets a signed 12-hour session cookie; the Worker verifies it on **every** request, including the app's
  own files, and rejects any email outside `ALLOWED_EMAIL_DOMAINS`. Cloudflare Access is on Bypass for this host
  (it charges a seat per person). Details: the overyondrdev.com platform guide (overyondr-website-v1 `docs/PLATFORM.md`).
- **No bypasses:** `workers_dev` and `preview_urls` are off.
- **Permissions in the API:** every rule lives in `public/js/shared/workflow.js` and is enforced by the Worker; the UI
  only hides what you can't do. Requests are visible only to the requester, approver, followers and marketing.
  Internal notes are marketing-only. Refs that you can't see return 404.
- **CSRF:** state-changing calls need the `X-Requested-With: mrp` header and a same-origin `Origin`.
- **Files:** private R2 bucket, served only through the Worker after a permission check; anything a browser could run
  is downloaded rather than shown, with a sandboxing CSP.
- **Headers:** strict CSP (scripts from this origin only), `X-Frame-Options: DENY`, HSTS, `nosniff`, `noindex`.
- **Secrets** (`OWNER_EMAILS`, `RESEND_API_KEY`, `SLACK_WEBHOOK_URL`) are Worker secrets, never committed; CI fails if a tracked file looks like it holds
  an API key, token or private key (`scripts/secret-scan.mjs`). `DEV_EMAIL` is for local
  `.dev.vars` only and must never be set in production.
