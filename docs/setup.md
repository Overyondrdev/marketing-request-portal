# Setup and deploy

What already exists (Yondr Cloudflare account `3fac6c19097c5692e17198cffa818085`, as in `wrangler.jsonc`):

- D1 database `yondr-marketing-requests-db` (`78cc06d7-c778-47eb-b630-6b9b0da5c43c`), referenced in `wrangler.jsonc`
- Private R2 bucket `yondr-marketing-requests-files`

Everything below is one-time.

## 1. Connect deploys (Cloudflare Workers Builds)

Like the website and ad library, merges to `main` deploy themselves and no Cloudflare credentials are stored in GitHub.
Cloudflare dashboard → Workers & Pages → Create → Import a repository → `Overyondrdev/marketing-request-portal`:

| Setting                      | Value                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Project / Worker name        | `yondr-marketing-requests`                                                                     |
| Production branch            | `main`                                                                                         |
| Build command                | `npm ci && npm run typecheck && npm test`                                                      |
| Deploy command               | `npx wrangler d1 migrations apply yondr-marketing-requests-db --remote && npx wrangler deploy` |
| Non-production branch builds | Off (preview URLs would sit outside Access)                                                    |

The first deploy attaches the custom domain `requests.overyondrdev.com` (from `routes` in `wrangler.jsonc`).

Manual deploy instead (needs `CLOUDFLARE_API_TOKEN`): `npm run deploy` (applies migrations, then deploys).

## 2. Secrets

```sh
npx wrangler secret put OWNER_EMAILS        # comma-separated; these people are always admins
npx wrangler secret put SLACK_WEBHOOK_URL   # optional: Slack incoming webhook for the marketing channel
```

Owners then make the rest of the team marketing / leads, and mark approvers, under **People & routing**.

## 3. Sign-in (Cloudflare Access)

The Access app "overyondrdev.com (Yondr website dev)" in team `overyondr.cloudflareaccess.com` covers
`*.overyondrdev.com`, so `requests.overyondrdev.com` is protected as soon as it exists: one-time code to any
`@overyondr.com` address. Check after the first deploy by opening the URL in a private window — you should see the
Access login, not the app. The Worker also verifies the Access token and only accepts `ALLOWED_EMAIL_DOMAINS`.

If the portal should get its own login page or session length, add a dedicated Access application for
`requests.overyondrdev.com` with an _Emails ending in_ `@overyondr.com` policy.

## 4. Email (Cloudflare Email Service)

In-app notifications work from day one. To email approvers, creators and requesters:

1. Cloudflare dashboard → Compute → Email Service → Email Sending → **Onboard Domain** → `overyondrdev.com`
   (adds SPF, DKIM and DMARC records on Cloudflare DNS). Sending to any recipient needs the Workers Paid plan.
2. In `wrangler.jsonc` set `"EMAIL_ENABLED": "on"` (and change `MAIL_FROM` if you want another sender), merge.
3. Submit a test request and check the approver's inbox (and Email Service → logs).

To send from `@overyondr.com` instead, that domain must be on Cloudflare DNS and onboarded the same way.

## 5. Check it

- Open the portal, set your manager in Settings, submit a request, approve it as the manager, deliver and accept it.
- Workers & Pages → `yondr-marketing-requests` → Logs shows errors; Settings → Triggers shows the reminder schedule.

## Backups and data

D1 has Time Travel (point-in-time restore for 30 days): `npx wrangler d1 time-travel info yondr-marketing-requests-db`.
Export a copy any time: `npx wrangler d1 export yondr-marketing-requests-db --remote --output backup.sql`.
Reports → Export CSV gives every request in a date range for spreadsheets.
