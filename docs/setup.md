# Setup and deploy

What already exists (Yondr Cloudflare account `3fac6c19097c5692e17198cffa818085`, as in `wrangler.jsonc`):

- D1 database `yondr-marketing-requests-db` (`78cc06d7-c778-47eb-b630-6b9b0da5c43c`), referenced in `wrangler.jsonc`
- Private R2 bucket `yondr-marketing-requests-files`

Everything below is one-time. Handing the Cloudflare part to an agent? Give it
[cloudflare-setup-chrome.md](cloudflare-setup-chrome.md) (step-by-step for a browser agent in Chrome).

## 1. Connect deploys (Cloudflare Workers Builds)

Like the website and ad library, merges to `main` deploy themselves and no Cloudflare credentials are stored in GitHub.
Do this **after the first pull request is merged**: connecting starts a build of `main` straight away, and it needs the
app to be there.

1. Cloudflare dashboard (account that owns the D1 database above) → **Workers & Pages** → **Create** (Create
   application) → **Import a repository**.
2. Choose **GitHub**. If `Overyondrdev/marketing-request-portal` isn't listed, follow the link to configure the
   Cloudflare Workers & Pages GitHub app and give it access to that repository (an `Overyondrdev` org owner may need
   to approve it).
3. Select `Overyondrdev/marketing-request-portal` and fill in:

| Setting                      | Value                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Project / Worker name        | `yondr-marketing-requests` (must match `name` in `wrangler.jsonc`)                             |
| Production branch            | `main`                                                                                         |
| Root directory               | leave empty (repository root)                                                                  |
| Build command                | `npm ci && npm run typecheck && npm test`                                                      |
| Deploy command               | `npx wrangler d1 migrations apply yondr-marketing-requests-db --remote && npx wrangler deploy` |
| Build variables              | `NODE_VERSION` = `22`                                                                          |
| Non-production branch builds | **Off** (preview URLs would sit outside Access)                                                |

4. **Save and Deploy**. The build log shows each step; the first deploy creates the tables (migrations) and attaches
   the custom domain `requests.overyondrdev.com` (from `routes` in `wrangler.jsonc`).
5. Then add the secrets (section 2) and open the portal.

If a build fails on the migrations step with a permissions error, edit the build's API token (Worker → Settings →
Builds → API token) so it has **D1: Edit**, and retry the build.

Manual deploy instead (needs `CLOUDFLARE_API_TOKEN`): `npm run deploy` (applies migrations, then deploys).

## 2. Secrets

```sh
npx wrangler secret put OWNER_EMAILS        # comma-separated; these people are always admins
npx wrangler secret put RESEND_API_KEY      # email (section 4)
npx wrangler secret put SLACK_WEBHOOK_URL   # optional: Slack incoming webhook for the marketing channel
```

Or in the dashboard: Workers & Pages → `yondr-marketing-requests` → Settings → Variables and Secrets → Add → type
**Secret**. Secrets survive deploys. Owners then make the rest of the team marketing / leads, and mark approvers, under **People & routing**.

## 3. Sign-in (Cloudflare Access)

The Access app "overyondrdev.com (Yondr website dev)" in team `overyondr.cloudflareaccess.com` covers
`*.overyondrdev.com`, so `requests.overyondrdev.com` is protected as soon as it exists: one-time code to any
`@overyondr.com` address. Check after the first deploy by opening the URL in a private window — you should see the
Access login, not the app. The Worker also verifies the Access token and only accepts `ALLOWED_EMAIL_DOMAINS`.

If the portal should get its own login page or session length, add a dedicated Access application for
`requests.overyondrdev.com` with an _Emails ending in_ `@overyondr.com` policy.

## 4. Email (Resend)

In-app notifications work from day one. Email goes to approvers ("Approval needed"), creators ("New work for you"),
requesters ("Ready for your review", questions) and reminders, through [Resend](https://resend.com). The Worker calls
Resend's batch API (`src/lib/notify.ts`); each person gets their own message, with replies going to the person who
acted.

1. **Account.** Sign up at resend.com with a shared marketing or web-admin address and invite the people who should
   manage email (Settings → Team).
2. **Domain.** Domains → **Add domain** → `mail.overyondr.com` (region: US East). A subdomain keeps this portal's
   sending reputation separate from everyone's own `@overyondr.com` mail. It's the sender in `MAIL_FROM`
   (`requests@mail.overyondr.com`); if you choose another domain, change `MAIL_FROM` in `wrangler.jsonc` to match.
3. **DNS.** Resend shows the records to add: an MX and a TXT (SPF) record for its bounce subdomain, and a TXT (DKIM)
   record. Add them **exactly as shown** wherever `overyondr.com`'s DNS is managed (today that's the Squarespace
   domain settings), then press **Verify DNS Records** in Resend. Verification usually takes minutes, sometimes hours.
   If `overyondr.com` has no DMARC record yet, add TXT `_dmarc.mail` = `v=DMARC1; p=none;`.
   Using `overyondrdev.com` instead (already on Cloudflare DNS)? Resend can add the records to Cloudflare for you
   from the domain page.
4. **Tracking off.** On the domain's settings, turn **open tracking** and **click tracking** off: these are internal
   notifications, and click tracking would rewrite links to the portal through Resend.
5. **API key.** API Keys → **Create API key**: name `yondr-marketing-requests`, permission **Sending access**,
   domain `mail.overyondr.com`. Copy it (it's shown once), then store it as a Worker secret:
   `npx wrangler secret put RESEND_API_KEY` (or in the dashboard, section 2). Never commit it or paste it in chat.
6. **Switch on.** In `wrangler.jsonc` set `"EMAIL_ENABLED": "on"` and merge the pull request. Email sends only when
   this is `on` **and** the key is set; Settings in the portal tells people whether email is on.
7. **Test.** Submit a request with yourself as someone else's approver (or ask a colleague), and check the inbox and
   Resend → **Emails** (each message, its status and any bounce). Worker logs show `resend <status>` if a send fails.
8. **Inbox placement.** If Gmail files the first emails as spam, a Google Workspace admin can add
   `mail.overyondr.com` under Admin console → Apps → Google Workspace → Gmail → Spam, phishing and malware →
   Approved senders.

Check Resend's plan limits (daily and monthly emails) against the team's volume; every notification that needs
someone to act is emailed, plus plain updates for people who leave "Email me updates" on. Locally, emails are only
sent if you put a key and `EMAIL_ENABLED="on"` in `.dev.vars`; use a separate test key.

## 5. Check it

- Open the portal, set your manager in Settings, submit a request, approve it as the manager, deliver and accept it.
- Resend → Emails shows every notification email and whether it was delivered.
- Workers & Pages → `yondr-marketing-requests` → Logs shows errors; Settings → Triggers shows the reminder schedule.

## Backups and data

D1 has Time Travel (point-in-time restore for 30 days): `npx wrangler d1 time-travel info yondr-marketing-requests-db`.
Export a copy any time: `npx wrangler d1 export yondr-marketing-requests-db --remote --output backup.sql`.
Reports → Export CSV gives every request in a date range for spreadsheets.
