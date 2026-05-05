# Cloudflare PR preview deploys (DEE-51)

GitHub Actions runs an **optional** Workers preview for PRs targeting `dev` or `main`, separate from any future **production** deploy flow.

Primary workflow file: [.github/workflows/cloudflare-preview.yml](../.github/workflows/cloudflare-preview.yml).  
Existing unit/e2e/build checks remain in [.github/workflows/ci.yml](../.github/workflows/ci.yml).

Related: [cloudflare-deploy.md](cloudflare-deploy.md) (manual/production-oriented), [cloudflare-env-vars.md](cloudflare-env-vars.md) (environment inventory).

---

## What runs on each PR

1. **Cloudflare bundle (always for in-scope PRs)**  
   Job `opennext-bundle`: **`run` steps** use **`working-directory: waia-app`** so install, SQLite migrate (`pnpm db:migrate`), and `pnpm cloudflare:build` run in the Next app root. Upload path **`waia-app/.open-next`** is repository-root–relative (`actions/upload-artifact` ignores shell cwd) with 3-day retention. A debug listing runs before upload to confirm `.open-next` exists.

2. **Deploy preview Worker (conditional)**  
   Job `deploy-cloudflare-preview` is **skipped entirely** only for **fork** PRs (`head.repo` must equal this repository).

   When the PR is from this repo, the job starts; a **`Check Cloudflare secrets`** step then sets `has_cloudflare_secrets`. If **`CLOUDFLARE_API_TOKEN`** or **`CLOUDFLARE_ACCOUNT_ID`** is unset or empty, a notice step logs that preview deploy was skipped — **later deploy steps do not run** and the workflow still **passes**. When both secrets exist, the workflow downloads the bundle into **`waia-app/.open-next`** and runs **`wrangler deploy`** from **`waia-app/`**. The bundle job always validates the OpenNext build independently.

**Production** `waia-app` deploys are **not** triggered by this workflow (no `push` to `dev` deploy here).

---

## Required GitHub secrets

Add in **Settings → Secrets and variables → Actions** (repository):

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | API token with permission to deploy Workers for the account (e.g. **Workers Scripts: Edit** on the target account). |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID (Wrangler / dashboard). |

Never commit these values. Do not check in `.dev.vars` with real tokens (see [.dev.vars.example](../.dev.vars.example)).

---

## Preview Worker naming

Each PR gets a dedicated script name:

`waia-app-pr-<PR_NUMBER>`

Wrangler config is copied from [`wrangler.jsonc`](../wrangler.jsonc) at deploy time so **`name`** and **`services[0].service`** (`WORKER_SELF_REFERENCE`) stay aligned with that preview name.

---

## Where to see the preview URL

- A **PR comment** (updated on each successful deploy) with marker `<!-- waia-cloudflare-preview -->`.
- If log parsing does not find a `*.workers.dev` URL, the comment points you to the **Cloudflare dashboard** for that Worker name.
- **Actions** tab → workflow run logs for `wrangler deploy`.

---

## Limitations (database / runtime)

The OpenNext **bundle build** succeeds in CI, but the app still uses **`better-sqlite3`** and **file SQLite** locally. That stack is **not production-viable on Workers** (see [cloudflare-deploy.md](cloudflare-deploy.md)).

Preview URLs are useful for **routing, static assets, and Worker packaging smoke tests**. **Sign-in, sessions, and API routes that call `getDb()` are expected to fail or misbehave** until persistence is moved to **D1** or **external Postgres** (Neon, Supabase, etc.).

---

## Rollback and cleanup

- **Same PR, new commits:** Redeploy **overwrites** the same `waia-app-pr-<N>` Worker version — no extra cleanup.
- **Merged or closed PR:** The preview Worker is **not** deleted automatically. Remove stale scripts in the Cloudflare dashboard or with Wrangler when you no longer need them (avoids clutter and old env drift).
- **Rollback a bad preview deploy:** Redeploy from an earlier commit on the PR branch, or delete the Worker and let the next run recreate it.

---

## Local parity commands

```bash
pnpm exec vitest run
pnpm lint
pnpm typecheck
pnpm build
pnpm cloudflare:build
```
