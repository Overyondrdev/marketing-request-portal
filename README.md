# Yondr marketing request portal

**https://requests.overyondrdev.com** — one place for anyone at Yondr to ask marketing for work, get it approved,
and follow it to delivery: copy, decks, one-pagers, ads, web pages, video, trade show kits and everything between.

- **A brief that asks the right questions.** 24 request types in 8 categories, each with its own questions; answers
  reveal follow-up questions only when they apply. A live _brief strength_ meter and tips show what would save a round
  of questions. Turnaround guidance per type flags rush dates and asks why.
- **Approval.** Requests go to the requester's manager (set once in Settings, changeable per request) by email and
  in the portal. Approvers approve, decline with a reason, or ask a question first.
- **Routing.** Once approved, the request goes to the type's default creator (set by leads under _People & routing_),
  who is alerted straight away; otherwise it lands in the queue and leads are alerted to assign it.
- **Questions in the system.** Ask a question in the request; _pause work until answered_ puts the request in
  "Question for requester", and answering resumes it automatically. Marketing keeps private internal notes.
- **Everyone sees where it is.** A progress bar (Brief → Manager approval → Marketing queue → In production →
  Your review → Delivered) with dates, and _Waiting on_ naming who has the next move. Notifications at every step;
  reminders for approvals, questions and reviews that wait, and for work due soon or overdue.
- **Review and close.** Deliverables are versioned by round. Requesters accept (with a 1–5 rating) or ask for changes.
  Ad creative is reviewed in the [ad library](https://ads.overyondrdev.com); ad requests link to it.
- **Work queue and reports for marketing.** Board, list and calendar views; workload per person; reports on volume,
  approval time, first response, turnaround, on-time delivery, first-time-right, ratings, by type, department and
  person; CSV export.
- **Yondr only.** Cloudflare Access sign-in with an `@overyondr.com` email, re-verified by the Worker on every request.

## Roles

| Role                                | Can                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Requester (everyone)                | Create requests, answer questions, follow requests, review and accept deliverables. Sees their own requests and ones they approve or follow. |
| Approver (a flag, usually managers) | Approve, decline or question requests sent to them.                                                                                          |
| Marketing team                      | See every request; pick up, produce and deliver work; ask questions; internal notes; work queue and reports (own workload).                  |
| Marketing lead                      | + approve on anyone's behalf, assign and reassign, routing per request type, everyone's workload in reports, manage approvers and managers.  |
| Admin                               | + change roles. Owners (the `OWNER_EMAILS` secret) are always admins.                                                                        |

Every rule is defined once in `public/js/shared/workflow.js` and enforced by the API; the UI only hides what you can't do.

## How it's built

A single Cloudflare Worker (`yondr-marketing-requests`), no frameworks, no runtime dependencies.

| Path                                    | What                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`                          | Router, sign-in check on every request, CSRF guard, security headers, scheduled reminders                                |
| `src/lib/access.ts`                     | Cloudflare Access token verification and the Yondr-only email check                                                      |
| `src/api/requests.ts`                   | Lists, home, drafts, the workflow actions (submit, approve, assign, deliver, accept…) and routing                        |
| `src/api/conversation.ts`               | Comments, questions (blocking or not), answers, internal notes                                                           |
| `src/api/files.ts`                      | Uploads to and downloads from R2, with permission checks                                                                 |
| `src/api/reports.ts`                    | Report figures and CSV export                                                                                            |
| `src/api/admin.ts`, `src/api/me.ts`     | People, roles, routing per type; profile, directory                                                                      |
| `src/lib/notify.ts`                     | In-app notifications, email (Cloudflare Email Service) and Slack                                                         |
| `src/cron.ts`                           | Reminders (weekdays, twice a day)                                                                                        |
| `public/js/shared/catalog.js`           | **The request catalog**: categories, types, questions, turnaround, validation, brief score. Shared by browser and Worker |
| `public/js/shared/workflow.js`          | Statuses, stages, actions and who may take them. Shared by browser and Worker                                            |
| `public/js/app.js`, `public/js/views/*` | The app shell and screens (home, new request, request page, lists, queue, reports, admin, settings, help)                |
| `public/css/*`                          | Design system (`base.css`) and screen styles; Yondr Brand Guidelines v1.0                                                |
| `migrations/`                           | D1 schema (`yondr-marketing-requests-db`)                                                                                |
| `test/`                                 | Vitest in the Workers runtime: catalog and workflow rules, the API end to end, the Access check                          |

Data: D1 `yondr-marketing-requests-db` (requests, comments, files, events, notifications, users, type settings);
files in the private R2 bucket `yondr-marketing-requests-files`.

## Develop

```sh
npm ci
cp .dev.vars.example .dev.vars        # set DEV_EMAIL and OWNER_EMAILS to your address (local only)
npm run migrate:local
npm run dev                           # http://localhost:8787
npm run seed:local                    # in another terminal: sample people and requests in every state
```

Act as someone else locally by sending an `X-Dev-Email` header (e.g. with a browser extension), or change
`DEV_EMAIL`. The seed script prints the sample identities.

```sh
npm run check                         # everything CI runs: types, browser JS, formatting, tests, dry-run bundle
npm test                              # tests only
npm run format                        # fix formatting
```

**Adding or changing a request type** is a change to `public/js/shared/catalog.js` only: add it to `TYPES` with its
questions. The form, validation, brief score, emails, exports and reports pick it up. Keep ids stable (they are stored
with requests). `test/shared.test.ts` checks the catalog is well formed.

**Changing the database:** add a new numbered file in `migrations/` (never edit an applied one) and run
`npm run migrate:local`. Deploys apply new migrations before the new code goes live.

## Deploy

Merges to `main` deploy automatically through Cloudflare Workers Builds (migrations first, then the Worker). First-time
setup, secrets, email and Access: [docs/setup.md](docs/setup.md). GitHub repository settings: [docs/repo-settings.md](docs/repo-settings.md).

## Contributing

Branch from `main` (`feature/…`, `fix/…`, `content/…`), run `npm run check`, open a pull request with the template.
The **check** job must pass and changes to deploy config, migrations or access control need a code owner's review.
See [CLAUDE.md](CLAUDE.md) for the conventions. Security: [SECURITY.md](SECURITY.md).

© Yondr, Inc. Internal software, all rights reserved. Fraunces and Inter Tight fonts are under the SIL Open Font License
(`public/brand/fonts/OFL-*.txt`).
