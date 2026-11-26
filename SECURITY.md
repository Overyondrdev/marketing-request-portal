# Security

The portal holds internal Yondr briefs and files. Report anything that could expose them to a web admin directly
(not in a public channel or issue).

## How the portal is protected

- **Sign-in:** Cloudflare Access (one-time code to an `@overyondr.com` address) in front of `requests.overyondrdev.com`.
- **Defence in depth:** the Worker verifies Access's signed token on every request (signature, issuer, expiry) and
  rejects any email outside `ALLOWED_EMAIL_DOMAINS` — including the app's own static files (`run_worker_first`).
- **No bypasses:** `workers_dev` and `preview_urls` are off.
- **Permissions in the API:** every rule lives in `public/js/shared/workflow.js` and is enforced by the Worker; the UI
  only hides what you can't do. Requests are visible only to the requester, approver, followers and marketing.
  Internal notes are marketing-only. Refs that you can't see return 404.
- **CSRF:** state-changing calls need the `X-Requested-With: mrp` header and a same-origin `Origin`.
- **Files:** private R2 bucket, served only through the Worker after a permission check; anything a browser could run
  is downloaded rather than shown, with a sandboxing CSP.
- **Headers:** strict CSP (scripts from this origin only), `X-Frame-Options: DENY`, HSTS, `nosniff`, `noindex`.
- **Secrets** (`OWNER_EMAILS`, `SLACK_WEBHOOK_URL`) are Worker secrets, never committed. `DEV_EMAIL` is for local
  `.dev.vars` only and must never be set in production.
