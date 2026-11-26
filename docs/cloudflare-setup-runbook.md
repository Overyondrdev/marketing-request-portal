# Cloudflare setup runbook (for an agent)

You are setting up the production Cloudflare side of the **Yondr marketing request portal**, a Cloudflare Worker in the
repository `Overyondrdev/marketing-request-portal`. Work through the steps in order. Each step says what to do, how to
check it worked, and what to leave to a person. Stop and ask the person you work for whenever a step says **ASK**, a
check fails in a way this runbook doesn't cover, or you would have to delete or overwrite anything.

## Facts

| Thing                        | Value                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare account ID        | `3fac6c19097c5692e17198cffa818085` (the account that owns `overyondrdev.com`)                                               |
| Worker name                  | `yondr-marketing-requests` (must match `name` in `wrangler.jsonc`)                                                          |
| Hostname                     | `requests.overyondrdev.com` (custom domain, declared in `routes` in `wrangler.jsonc`)                                       |
| D1 database                  | `yondr-marketing-requests-db`, id `78cc06d7-c778-47eb-b630-6b9b0da5c43c` (already created, empty)                           |
| R2 bucket                    | `yondr-marketing-requests-files` (already created, private)                                                                 |
| Access team                  | `overyondr.cloudflareaccess.com`                                                                                            |
| Existing Access app          | "overyondrdev.com (Yondr website dev)": one-time PIN to `@overyondr.com` emails, 7-day session, covers `*.overyondrdev.com` |
| Reminder schedule            | cron `5 14,19 * * 1-5` (in `wrangler.jsonc`)                                                                                |
| Secrets                      | `OWNER_EMAILS` (required), `RESEND_API_KEY` (for email), `SLACK_WEBHOOK_URL` (optional)                                     |
| Other Workers in the account | `overyondr-website-v1`, `yondr-ad-portal`, `yondr-christmas-cards`: **do not change them**                                  |

Read `README.md`, `docs/setup.md` and `wrangler.jsonc` in the repository before you start.

## Rules

- Never set `workers_dev` or `preview_urls` to true, never enable non-production branch builds, and never give the R2
  bucket a public URL (r2.dev or a custom domain). Each of these would expose internal briefs outside the Yondr login.
- Never add routes for `overyondr.com` or change DNS for `overyondr.com`, `www`, `v1`, `v2` or `ads` hosts.
- Never change the existing Access app's policies, and never create an Access **bypass** or **service-auth** policy.
- Never read, print, paste or commit a secret's value. Secrets are entered by a person (dashboard or an interactive
  `wrangler secret put` they run), or piped from a variable they set. Don't put personal email addresses in committed
  files.
- Never run `wrangler d1 execute` with anything other than `SELECT` against `--remote`, and never delete a database,
  bucket, Worker or DNS record. Migrations only through `wrangler d1 migrations apply`.
- Don't edit application code. If a fix in the repository is needed, describe it and ask; changes go through a pull
  request into `main` (see `CLAUDE.md`).

## Step 0 — Preflight (read-only)

1. Confirm the first pull request is merged: `main` must contain `package.json`, `wrangler.jsonc`, `src/` and
   `migrations/0001_init.sql`, and its GitHub check **check** must be green. If `main` only has a README, **stop and
   ASK** the person to merge the pull request first (Workers Builds would build an empty app).
2. Confirm you are in account `3fac6c19097c5692e17198cffa818085` and that:
   - D1 `yondr-marketing-requests-db` exists with id `78cc06d7-c778-47eb-b630-6b9b0da5c43c`;
   - R2 bucket `yondr-marketing-requests-files` exists with public access **disabled**;
   - no Worker named `yondr-marketing-requests` exists yet (if one does, read it and **ASK** before continuing).
3. Locally (optional but recommended): clone `main`, `npm ci`, `npm run check`. It must pass.

## Step 1 — Connect Workers Builds (merges to `main` deploy themselves)

This connects GitHub to Cloudflare, so it needs the Cloudflare dashboard. If you can't operate the dashboard, give the
person these exact settings and wait for them to confirm.

1. Dashboard → **Workers & Pages** → **Create** → **Import a repository** → **GitHub**.
2. If the repository isn't listed: the "Cloudflare Workers and Pages" GitHub app needs access to
   `Overyondrdev/marketing-request-portal`. **ASK** the person; an `Overyondrdev` GitHub org owner may have to approve.
3. Settings:

   | Setting                      | Value                                                                                          |
   | ---------------------------- | ---------------------------------------------------------------------------------------------- |
   | Worker / project name        | `yondr-marketing-requests`                                                                     |
   | Production branch            | `main`                                                                                         |
   | Root directory               | empty (repository root)                                                                        |
   | Build command                | `npm ci && npm run typecheck && npm test`                                                      |
   | Deploy command               | `npx wrangler d1 migrations apply yondr-marketing-requests-db --remote && npx wrangler deploy` |
   | Build variables              | `NODE_VERSION` = `22`                                                                          |
   | Non-production branch builds | **Off**                                                                                        |
   | Build watch paths            | default (all)                                                                                  |

4. **Save and Deploy**, then watch the build log to the end.
   - If the migrations step fails with an authorization or permission error, edit the build API token (Worker →
     Settings → Builds → API token) to add **D1: Edit** (the account's D1), and retry the build.
   - If `npm test` fails, stop and report the failing test; don't change the build command to skip it.

**Check:**

- The Worker `yondr-marketing-requests` exists, its latest deployment is from the `main` commit you expect.
- Worker → Settings → **Domains & Routes** shows the custom domain `requests.overyondrdev.com` (active), and
  `workers.dev` and **Preview URLs** are both **disabled**.
- Worker → Settings → **Trigger events** shows the cron `5 14,19 * * 1-5`.
- Bindings: `DB` → `yondr-marketing-requests-db`, `FILES` → `yondr-marketing-requests-files`, `ASSETS` (static
  assets). There must be **no** `send_email` binding (email goes through Resend).
- `npx wrangler d1 migrations list yondr-marketing-requests-db --remote` reports no pending migrations, and
  `npx wrangler d1 execute yondr-marketing-requests-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"`
  lists `users`, `requests`, `comments`, `files`, `events`, `notifications`, `watchers`, `type_settings`,
  `reminders`, `audit`.

Fallback if Workers Builds can't be connected now: a person with a Cloudflare API token can run `npm run deploy` from
an up-to-date `main` checkout (it applies migrations, then deploys). Report that automatic deploys are still not set up.

## Step 2 — Confirm the Yondr-only sign-in (Cloudflare Access)

The existing Access app covers `*.overyondrdev.com`, so the new hostname should already be protected.

**Check (no credentials needed):**

```sh
curl -sI https://requests.overyondrdev.com/ | head -5
```

Expect a redirect (`302`) to `https://overyondr.cloudflareaccess.com/...` — the Access login — **not** a `200` with
the app, and not a `401` from the Worker. Also check `https://requests.overyondrdev.com/api/me` the same way.

- If you get the Access redirect: done. Note it in your report.
- If you get the app or a Worker `401` page instead, Access isn't covering the hostname. **ASK** before changing
  anything, then propose: Zero Trust → Access → Applications → **Add an application** → Self-hosted, name
  "Marketing requests (requests.overyondrdev.com)", domain `requests.overyondrdev.com`, session 7 days (match the
  existing app), identity provider One-time PIN, one **Allow** policy: _Include_ → _Emails ending in_ →
  `@overyondr.com`. Nothing else.

The Worker itself also verifies Access's signed token and accepts only `@overyondr.com`, so a misconfigured Access
fails closed (people see a sign-in message, never data).

## Step 3 — Secrets

Set these on the Worker `yondr-marketing-requests` (dashboard: Worker → Settings → Variables and Secrets → Add →
type **Secret**; or `npx wrangler secret put <NAME>` from the repository). Secrets survive deploys.

| Secret              | Value                                                         | Who provides it                                          |
| ------------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| `OWNER_EMAILS`      | Comma-separated `@overyondr.com` emails who are always admins | **ASK** the person for the list                          |
| `RESEND_API_KEY`    | Resend API key with _Sending access_ for the sending domain   | The person creates it in Resend and enters it themselves |
| `SLACK_WEBHOOK_URL` | Optional Slack incoming-webhook URL for the marketing channel | The person, only if they want Slack posts                |

Don't ask anyone to paste a key into chat. If you have a terminal they control, let them run
`npx wrangler secret put RESEND_API_KEY` and type it at the prompt.

**Check:** `npx wrangler secret list` shows the names (never the values). Do **not** change `EMAIL_ENABLED` yourself:
it is `"off"` in `wrangler.jsonc` and is switched on by a pull request once Resend is verified (Step 4).

## Step 4 — Email DNS for Resend (only the parts on Cloudflare)

The plan in `docs/setup.md` sends from `requests@mail.overyondr.com`. `overyondr.com`'s DNS is **not** on Cloudflare
(it is managed at Squarespace), so for that domain a person adds the records Resend shows, at Squarespace. Your part:
nothing, other than reminding them.

Only if the person decides to send from a subdomain of **`overyondrdev.com`** instead (its DNS **is** on Cloudflare):

1. **ASK** for the exact records Resend displays (or use Resend's "add to Cloudflare" option, which the person
   authorizes).
2. Add exactly those records in the `overyondrdev.com` zone: MX and TXT (SPF) on Resend's bounce subdomain, TXT
   (DKIM) on `resend._domainkey.<subdomain>`. Proxy status **DNS only** (grey cloud). Don't touch existing records,
   especially any existing SPF or MX at the zone apex.
3. If the zone has no DMARC for that subdomain, add TXT `_dmarc.<subdomain>` = `v=DMARC1; p=none;`.
4. Tell the person to press **Verify** in Resend, and that `MAIL_FROM` in `wrangler.jsonc` must change to an address
   on that subdomain (pull request).

**Check:** `dig +short TXT resend._domainkey.<subdomain>` (and the MX/SPF names) return the values Resend expects.

## Step 5 — Final checks

Read-only, then report:

- Worker logs (Observability) for the last deployment show no errors on startup.
- `curl -sI` on `/`, `/api/me` and `/brand/yondr-dark-green.svg` all redirect to the Access login: Access guards the
  whole hostname before the Worker runs.
- R2 bucket `yondr-marketing-requests-files`: public access disabled, no custom domains, no CORS rules needed.
- Ask the person to sign in at https://requests.overyondrdev.com, open **Settings**, set their manager, submit a test
  request, and confirm it appears. (You can't sign in for them: it is their one-time code.)

## Report back

Give the person a short report:

1. Each step: **done**, **done by you (person)**, **blocked** (why, and the exact next action), or **skipped** (why).
2. The live deployment's version/commit, the custom domain status, and the Access check result (`302` to the login).
3. Which secrets are set (names only) and which are still missing.
4. Anything you noticed that doesn't match this runbook, without having changed it.
