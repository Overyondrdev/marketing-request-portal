# Setup and deploy

What already exists (Yondr Cloudflare account `3fac6c19097c5692e17198cffa818085`, as in `wrangler.jsonc`):

- D1 database `yondr-marketing-requests-db` (`78cc06d7-c778-47eb-b630-6b9b0da5c43c`), referenced in `wrangler.jsonc`
- Private R2 bucket `yondr-marketing-requests-files`

Everything below is one-time. Handing the Cloudflare part to an agent? Give it
[cloudflare-setup-chrome.md](cloudflare-setup-chrome.md) (step-by-step for a browser agent in Chrome).

## 1. Deploys

Today the portal is deployed with `npm run deploy` (migrations, then the Worker) by someone with Cloudflare access,
including Claude cloud sessions. Automatic deploys on merge (below) need the Cloudflare GitHub app to have access to
this repository.

### Optional: Cloudflare Workers Builds

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

## 3. Sign-in (Yondr Google sign-in)

People sign in with their `@overyondr.com` Google account through `auth.overyondrdev.com`, shared by every
overyondrdev.com site; the Worker checks the session on every request. Cloudflare Access is on **Bypass** for this
host (Access application "Yondr sites (Google sign-in)"), because Access charges a seat per person. Nothing to set up
here; how it works and how to add a site: the [overyondrdev.com platform guide](https://github.com/Overyondrdev/overyondr-website-v1/blob/main/docs/PLATFORM.md).

## 4. Email (Resend)

In-app notifications work from day one. Email goes to approvers ("Approval needed"), creators ("New work for you"),
requesters ("Ready for your review", questions) and reminders, through [Resend](https://resend.com). The Worker calls
Resend's batch API (`src/lib/notify.ts`); each person gets their own message, with replies going to the person who
acted.

1. **Account.** Sign up at resend.com with a shared marketing or web-admin address and invite the people who should
   manage email (Settings → Team).
2. **Domain.** Domains → **Add domain** → `overyondrdev.com` (region: North Virginia, us-east-1). Email is sent from
   `marketing@overyondrdev.com` (`MAIL_FROM` in `wrangler.jsonc`).
3. **DNS.** Resend shows its records: a TXT (DKIM) record at `resend._domainkey`, and an MX and a TXT (SPF) record at
   `send`. Add each in Cloudflare (`overyondrdev.com` → DNS → Records → Add record), copied exactly, with **Proxy
   status: DNS only**. Don't change the existing records: `_dmarc` (`p=reject`) stays as it is (Resend's DKIM signature
   passes it), and the `cf-bounce` records belong to Cloudflare Email Service. Then press **Verify DNS records**.
4. **Tracking off.** On the domain page, turn **open tracking** and **click tracking** off.
5. **API key.** API Keys → **Create API key**: name `yondr-marketing-requests`, permission **Sending access**, domain
   `overyondrdev.com`. Copy it (it's shown once).
6. **Store the key.** Cloudflare → Workers & Pages → `yondr-marketing-requests` → Settings → Variables and Secrets →
   **Add** → type **Secret**, name `RESEND_API_KEY`, paste the key → **Deploy**. Never commit it or paste it in chat.
7. **Switch on.** Set `"EMAIL_ENABLED": "on"` in `wrangler.jsonc` and deploy. Email sends only when this is `on`
   **and** the key is set.
8. **Test.** Submit a request with someone else as approver and check the inbox and Resend → **Emails**.
9. **Replies.** Most emails reply to the person who acted. Reminders come from `marketing@overyondrdev.com`, which has
   no inbox; to catch replies, turn on Cloudflare **Email Routing** for `overyondrdev.com` and forward `marketing@` to
   a real address.

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
