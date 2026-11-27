> **Retired.** This was the first-time setup when the portal sat behind Cloudflare Access. The portal is live and now
> uses the Yondr Google sign-in; see `docs/setup.md` and the overyondrdev.com platform guide. Kept for reference.

# Set up the marketing request portal in Chrome (instructions for a browser agent)

You are a browser agent working in Chrome, signed in as a Yondr web admin. You will put the Yondr marketing request
portal live at **https://requests.overyondrdev.com**. Do the parts in order. After each numbered step, check the
**You should see** line before moving on. If the screen doesn't match, a button is missing, or anything asks you to
delete, overwrite or pay for something, **stop, take a screenshot and ask the person you work for.** Button names in
Cloudflare and GitHub change sometimes: if a label is slightly different, pick the obvious equivalent; if you're not
sure, ask.

**Never do these:** turn on "workers.dev", "Preview URLs" or "non-production branch builds"; make the R2 bucket
public; touch any other Worker (`overyondr-website-v1`, `yondr-ad-portal`, `yondr-christmas-cards`); change DNS or
Access settings for anything other than `requests.overyondrdev.com`; type, read aloud or paste a secret key into chat.
When a secret has to be entered, hand the keyboard to the person.

Values you'll need:

| Name                   | Value                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| Cloudflare account ID  | `3fac6c19097c5692e17198cffa818085`                                                             |
| GitHub repository      | `Overyondrdev/marketing-request-portal`                                                        |
| Branch with the portal | `claude/eager-volta-chwrdd`                                                                    |
| Worker name            | `yondr-marketing-requests`                                                                     |
| Database               | `yondr-marketing-requests-db`                                                                  |
| File bucket            | `yondr-marketing-requests-files`                                                               |
| Build command          | `npm ci && npm run typecheck && npm test`                                                      |
| Deploy command         | `npx wrangler d1 migrations apply yondr-marketing-requests-db --remote && npx wrangler deploy` |

---

## Part A — Merge the portal into `main` (GitHub)

Cloudflare deploys from `main`, which today only holds a README. The portal is on a branch.

1. Open `https://github.com/Overyondrdev/marketing-request-portal/pulls`.
   - If an open pull request from `claude/eager-volta-chwrdd` already exists, open it and go to step 3.
2. Open `https://github.com/Overyondrdev/marketing-request-portal/compare/main...claude/eager-volta-chwrdd` and click
   **Create pull request**. Title: `Marketing request portal v1`. Leave the description template as it is. Click
   **Create pull request**.
   **You should see** a pull request page with a check named **check** running.
3. Wait until the **check** status shows a green tick (refresh the page every minute; it takes about 2 minutes).
   If it shows a red cross, stop and ask.
4. **Ask the person:** "The portal pull request passed its checks. May I merge it into main?" Only after they say yes:
   click the arrow next to the merge button, choose **Squash and merge**, then **Confirm squash and merge**.
   **You should see** "Pull request successfully merged and closed".

## Part B — Check the database and file bucket exist (Cloudflare)

5. Open `https://dash.cloudflare.com/3fac6c19097c5692e17198cffa818085/workers/d1`.
   **You should see** a database named `yondr-marketing-requests-db`. Don't open or change it yet.
6. Open `https://dash.cloudflare.com/3fac6c19097c5692e17198cffa818085/r2/overview`. Click
   `yondr-marketing-requests-files` → **Settings**.
   **You should see** Public access / "R2.dev subdomain" **disabled** and no custom domains. If it is enabled, stop
   and ask (don't change it on your own).
7. Open `https://dash.cloudflare.com/3fac6c19097c5692e17198cffa818085/workers-and-pages`.
   **You should see** the existing Workers. If a Worker named `yondr-marketing-requests` **already exists**, stop and
   ask.

## Part C — Connect GitHub and deploy (Workers Builds)

8. On the Workers & Pages page, click **Create** (or **Create application**).
9. Choose **Import a repository** (on some screens: the **Workers** tab → **Import a repository**), then
   **Connect GitHub** / pick the GitHub account.
   - If `Overyondrdev/marketing-request-portal` isn't in the list, click the link to configure the GitHub app
     ("Cloudflare Workers and Pages"). On the GitHub page that opens, under **Repository access**, choose **Only select
     repositories**, add `marketing-request-portal` (keep the repositories already selected), click **Save**, and
     return to Cloudflare. If GitHub says an organization owner must approve, stop and ask the person.
10. Click **marketing-request-portal** → **Begin setup** / **Next**.
11. Fill in the form exactly:
    - **Project name / Worker name:** `yondr-marketing-requests`
    - **Production branch:** `main`
    - **Build command:** `npm ci && npm run typecheck && npm test`
    - **Deploy command:** `npx wrangler d1 migrations apply yondr-marketing-requests-db --remote && npx wrangler deploy`
    - **Root directory / Path:** leave empty
    - Open **Advanced settings** (if shown):
      - **Non-production branch deploy / builds:** off (unticked)
      - **Build variables:** add `NODE_VERSION` with value `22`
    - **API token:** leave the automatically created token.
12. Click **Save and Deploy** (or **Deploy**).
    **You should see** a build log. Wait until it finishes (2–4 minutes). It ends with lines saying migrations were
    applied (`0001_init.sql`) and the Worker was deployed with `requests.overyondrdev.com`.
    - If it fails with "Authentication error", "not authorized" or a permissions message at the **migrations** line:
      go to the Worker → **Settings** → **Build** → **API token** → edit the token → add permission
      **Account · D1 · Edit** → save → back on the Worker's **Deployments** tab click **Retry build** (or **Retry**).
    - Any other failure: screenshot the last 30 lines of the log and ask.

## Part D — Check the Worker's settings

13. Open the Worker: Workers & Pages → `yondr-marketing-requests` → **Settings**.
14. Under **Domains & Routes**:
    **You should see** `requests.overyondrdev.com` (Custom domain), and **workers.dev: Disabled** and
    **Preview URLs: Disabled**. If either is enabled, stop and ask (the code sets them off; a mismatch means a wrong
    deploy).
15. Under **Bindings**:
    **You should see** `DB` → D1 `yondr-marketing-requests-db`, `FILES` → R2 `yondr-marketing-requests-files`, and
    `ASSETS`.
16. Under **Trigger events** (or **Triggers → Cron Triggers**):
    **You should see** `5 14,19 * * 1-5`.
17. Under **Build**:
    **You should see** the repository connected, branch `main`, and the build/deploy commands from step 11.
18. Open D1 (`https://dash.cloudflare.com/3fac6c19097c5692e17198cffa818085/workers/d1`) →
    `yondr-marketing-requests-db` → **Tables**.
    **You should see** tables including `users`, `requests`, `comments`, `files`, `events`, `notifications`.
    Don't run any queries.

## Part E — Add the secrets (the person types the values)

19. Worker `yondr-marketing-requests` → **Settings** → **Variables and Secrets** → **Add**.
20. **Ask the person:** "Which @overyondr.com emails should always be admins of the portal?" Then:
    - **Type:** Secret · **Variable name:** `OWNER_EMAILS` · **Value:** the emails they give, separated by commas, no
      spaces (e.g. `name@overyondr.com,other@overyondr.com`). Click **Deploy** / **Save**.
21. Resend key (only if the person already created it in Resend; otherwise skip and mention it in your report):
    - Click **Add** → **Type:** Secret · **Variable name:** `RESEND_API_KEY`.
    - **Hand over to the person** to paste the key into **Value** themselves, then click **Deploy** / **Save**.
      Don't look at or repeat the key.
22. Slack (optional, only if the person wants it): same way, name `SLACK_WEBHOOK_URL`, the person pastes the URL.
    **You should see** the secrets listed by name with their values hidden. Leave `EMAIL_ENABLED` as `off`: it is
    switched on later through the code, after Resend is verified.

## Part F — Confirm only Yondr people can get in

23. Open a **new Incognito window** (Ctrl+Shift+N / Cmd+Shift+N) and go to `https://requests.overyondrdev.com`.
    **You should see** the Yondr / Cloudflare Access sign-in page asking for an email — **not** the portal.
    - If you see the portal itself, or a page saying "Please sign in with your Yondr email", the Access login is not
      covering this address. Stop and ask before changing anything. (The fix, once approved: Zero Trust
      `https://one.dash.cloudflare.com/` → **Access** → **Applications** → **Add an application** → **Self-hosted** →
      name `Marketing requests`, domain `requests.overyondrdev.com`, session 7 days, login method One-time PIN, policy
      **Allow** · Include · **Emails ending in** · `@overyondr.com`. Don't edit the existing application.)
24. Close the Incognito window.
25. **Ask the person** to open `https://requests.overyondrdev.com` in their normal window, sign in with their
    `@overyondr.com` email and the code they receive.
    **They should see** "Good morning/afternoon, <name>. What do you need from marketing?" and, if they're in
    `OWNER_EMAILS`, **People & routing** in the left menu.

## Part G — Report back

Tell the person, briefly:

- Pull request merged: yes/no (link).
- Build: succeeded / failed (and why), and the time of the deployment.
- Custom domain `requests.overyondrdev.com`: active? workers.dev and Preview URLs: disabled?
- Login check (step 23): sign-in page shown?
- Secrets set (names only): `OWNER_EMAILS`, `RESEND_API_KEY`, `SLACK_WEBHOOK_URL` — which are still missing.
- Anything that looked different from these instructions.

Still to do by people afterwards (not this agent): verify `mail.overyondr.com` in Resend and add its DNS records at
Squarespace, then turn email on (`EMAIL_ENABLED` → `on` through a pull request). See `docs/setup.md`, section 4.
