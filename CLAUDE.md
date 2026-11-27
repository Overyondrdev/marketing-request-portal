# Marketing request portal — instructions for Claude

The Yondr marketing request portal: a Cloudflare Worker (`yondr-marketing-requests`) with D1, R2, static assets and
Resend email, live at https://requests.overyondrdev.com behind the Yondr Google sign-in (`auth.overyondrdev.com`).
Read README.md for the map, and the shared **overyondrdev.com platform guide** ([docs/PLATFORM.md](https://github.com/Overyondrdev/overyondr-website-v1/blob/main/docs/PLATFORM.md) in
overyondr-website-v1) before changing sign-in, deploys or Cloudflare settings.

## Ship a change

1. Branch from `main` (`feature/<name>`, `fix/<thing>`, `content/<type>`).
2. `npm ci` (first time), make the change, then `npm run check` — it must pass (types, browser JS syntax, Prettier,
   Vitest, dry-run bundle). Run `npm run format` before committing.
3. Try it in `npm run dev` (with `.dev.vars` from `.dev.vars.example`; `npm run seed:local` for sample data) as every
   role it affects, at 1280px and 375px.
4. Push and open a PR into `main` with `.github/pull_request_template.md`. Merging deploys (Workers Builds).
   Never force-push `main`. Never commit `.dev.vars`, `.env*`, `dist/`, `.wrangler/`, `node_modules/` or secrets.

## Rules

- **Permissions live in `public/js/shared/workflow.js` and are enforced in the Worker.** A new action or visibility
  rule goes there and in `src/api/*`, never only in the UI. Unknown or invisible requests return 404.
- **Request types live in `public/js/shared/catalog.js`.** Don't hard-code type-specific logic elsewhere. Keep type and
  field ids stable; they are stored in briefs. Never invent statistics, quotes or claims in help text or examples.
- **Database:** add a new numbered migration; never edit an applied one. Keep changes additive so a deploy can't break
  running requests.
- **Security:** every route goes through the sign-in check in `src/index.ts` (`src/lib/access.ts` →
  `src/lib/yondr-session.js`, a copy of overyondr-website-v1 `auth/src/session.js`; keep it the same). Keep `workers_dev`/`preview_urls` false,
  `run_worker_first` true and the CSRF header on mutating calls. `DEV_EMAIL` is local-only. Secrets
  (`OWNER_EMAILS`, `RESEND_API_KEY`, `SLACK_WEBHOOK_URL`) go in `wrangler secret put`, never in `wrangler.jsonc`. Don't put personal
  emails in committed files; tests and seed data use fictional `@overyondr.com` identities.
- **Front end:** plain ES modules, no framework or build step. Render with the `html` tag from `public/js/lib/ui.js`
  (it escapes); never concatenate user data into markup. Use the tokens and components in `public/css/base.css`;
  Yondr Brand Guidelines v1.0 (Fraunces + Inter Tight, forest/lichen palette). Accessible: labels, focus states,
  keyboard operation, `prefers-reduced-motion`, no horizontal scroll at 375px.
- **Notifications** go through `notify()` in `src/lib/notify.ts`. Mark ones that need the recipient to act
  `actionNeeded` (always emailed); plain updates respect the person's email setting.
- Ask before adding a runtime dependency. Dev dependencies need a reason in the PR.
- Deploy with `npm run deploy` (migrations, then the Worker). The app's files are bundled into the Worker, so this
  works from Claude cloud sessions, which can't upload Workers static assets.
- After changing `wrangler.jsonc`, run `npm run cf-typegen` (move `.dev.vars` aside first so local values stay out of the types).
- The app in `public/` is bundled into the Worker by `scripts/build-static.mjs` (runs before dev, deploy, typecheck and
  tests). A new file type needs a content type there.
