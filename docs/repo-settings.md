# GitHub repository settings

Recommended settings for `Overyondrdev/marketing-request-portal`. These live in GitHub, not in the code, so a
repository admin applies them once (Settings in the repository).

## General

- Default branch: `main`.
- Pull requests: allow **squash merging** only; enable "Always suggest updating pull request branches" and
  "Automatically delete head branches".

## Branch protection (Settings → Rules → Rulesets → New branch ruleset, target `main`)

- Restrict deletions; block force pushes.
- Require a pull request before merging (1 approval for outside contributors; code owners review for files in
  `.github/CODEOWNERS`: deploy config, migrations, access control, CI).
- Require status checks to pass: **check** (from `.github/workflows/ci.yml`); require branches to be up to date.
- Require conversation resolution before merging.

## Security (Settings → Code security)

- Dependabot alerts and security updates: on (version updates are configured in `.github/dependabot.yml`).
- Secret scanning and push protection: on.
- Private vulnerability reporting: on.

## Actions (Settings → Actions → General)

- Workflow permissions: **Read repository contents** (the workflow also declares `contents: read`).
- Don't allow Actions to create or approve pull requests.

No Cloudflare secrets are needed in GitHub: deploys run in Cloudflare Workers Builds (see `docs/setup.md`).
