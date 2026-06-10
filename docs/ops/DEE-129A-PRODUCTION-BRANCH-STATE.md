# DEE-149 Production Branch State

**Linear:** [DEE-149](https://linear.app/deepsense/issue/DEE-149/dee-129a-verify-production-deploy-and-maindev-branch-lineage) (child of [DEE-129](https://linear.app/deepsense/issue/DEE-129/partner-preview-hardening-and-runtime-performance-stabilization-parent))  
**Audit date:** 2026-06-10  
**Repository tip audited:** `c0038d3` on `origin/dev`  
**Method:** Read-only — git, GitHub API, Wrangler CLI, production HTTP probe. No infrastructure or configuration changes.

---

## Executive Summary

WAIA production at **https://waia.life** is **operational** on Cloudflare Worker **`waia-app`** with **Postgres** backend confirmed via live health check. Git lineage is **healthy**: `origin/main` is an **ancestor** of `origin/dev` with **no unexpected divergence** (`main` 0 ahead, `dev` 224 ahead).

**Production deploy commit is not exposed** by `wrangler deployments list`. GitHub `main` tip is **`536a288`**; the latest recorded Worker deployment version is **`08166d50`** (2026-05-16). **`dev` is 224 commits ahead of `main`** — production does not automatically include post-`main` integration work until the next `dev` → `main` promotion and deploy.

This audit **unblocks DEE-150** (latency attribution) with verified branch facts and refreshed deployment metadata. Supabase **project identity** is confirmed from committed `wrangler.jsonc`; **live migration apply state** was not verified without database operator access.

---

## Git Branch Lineage

Evidence captured 2026-06-10 from local clone synced with `origin`.

### main

| Field | Value |
|-------|--------|
| **Tip (local + GitHub API)** | `536a288ffd26ba47f57a843c7e83091d3612e3b9` |
| **Tip message** | `release: promote dev to main after PR156 landing stabilization (#157)` |
| **Prior tip (context)** | `daed6bb` — `chore(release): promote dev to main (DEE-128 partner preview + DEE-129 AI runtime) (#149)` |

### dev

| Field | Value |
|-------|--------|
| **Tip (local + GitHub API)** | `c0038d3d2ff2730f858cbbd057de7c14a5607320` |
| **Tip message** | `fix(drizzle): load DATABASE_URL_POSTGRES from .env.local for Postgres Kit (#163)` |
| **Recent merge chain** | `#163` → `#162` → `#161` → `#160` → `#159` (`main` history merge into `dev`) |

### Relationship

| Check | Result | Evidence |
|-------|--------|----------|
| `main` ancestor of `dev` | **Yes** | `git merge-base --is-ancestor origin/main origin/dev` → exit 0 |
| Ahead/behind (`main...dev`) | **0 / 224** | `git rev-list --left-right --count origin/main...origin/dev` |
| Unexpected divergence | **None observed** | `main` is not ahead of `dev`; integration branch carries full `main` history plus 224 commits |
| GitHub default branch | **`dev`** | `gh api repos/oumaster369/waia` → `default_branch: dev` |

**Policy (documented):** Production releases promote from **`dev` → `main`**; humans deploy `waia-app` from **`main`** lineage per [DEE-128 release notes](DEE-128-PARTNER-PREVIEW-RELEASE-NOTES.md). `dev` is the integration branch, not the production deploy source.

---

## Production Deployment State

### Provider

| Field | Value |
|-------|--------|
| **Platform** | Cloudflare Workers (OpenNext bundle) |
| **Worker name** | `waia-app` ([`wrangler.jsonc`](../../wrangler.jsonc)) |
| **Deploy tooling** | Wrangler 4.87.0 (project devDependency); manual `pnpm cloudflare:deploy` per operator docs |
| **GitHub Actions production deploy** | **Not configured** — CI runs lint/test/build/e2e; preview workflow does not deploy production |

### Production URL

| Field | Value |
|-------|--------|
| **Canonical origin** | `https://waia.life` |
| **Committed vars** | `NEXT_PUBLIC_SITE_URL`, `OAUTH_PUBLIC_BASE_URL` → `https://waia.life` in `wrangler.jsonc` |

### Deployment Commit

| Field | Value |
|-------|--------|
| **Git commit on deployed Worker** | **Not available** from `wrangler deployments list` (shows version id + timestamp only) |
| **GitHub `main` tip (release lineage)** | `536a288` |
| **Stale reference in DEE-129 parent text** | `daed6bb` / Worker version `403074cc` — **superseded** by later deploy (see below) |
| **Inference (not verified)** | Production likely built from a `main`-lineage commit at or before `536a288` unless a manual deploy used another ref |

### Deployment Status

| Field | Value |
|-------|--------|
| **Latest Worker version (100% traffic)** | `08166d50-033e-41df-a455-9e69f57f569a` |
| **Latest deployment created** | `2026-05-16T19:53:13.795Z` |
| **Author** | `oumaster369@gmail.com` |
| **Prior notable version** | `403074cc-c7bc-4809-99e5-ace3018572f5` (2026-05-14T16:39:00Z) — referenced in DEE-129 issue text |
| **Live health probe** | `GET https://waia.life/api/health/database` → **HTTP 200**, body `{"backend":"postgres","ok":true}`, wall time **~1.28s** (2026-06-10 probe) |

---

## Cloudflare Verification

| Check | Finding |
|-------|---------|
| **Production Worker** | `waia-app` — deployments list succeeds under authenticated Wrangler |
| **Plain vars (committed)** | `WAIA_DB_BACKEND=postgres`, AI gateway foundation + `openai-compatible` + `gpt-5.5`, Supabase public URL/anon key — see [`wrangler.jsonc`](../../wrangler.jsonc) |
| **Secrets (names only)** | `DATABASE_URL`, `DATABASE_URL_POSTGRES`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `WAIA_AI_OPENAI_API_KEY` — verified via `wrangler secret list` |
| **Production branch policy** | Documented as **`main`** in [DEE-128](DEE-128-PARTNER-PREVIEW-RELEASE-NOTES.md); not auto-deployed from `dev` |
| **Preview branch behavior** | [`.github/workflows/cloudflare-preview.yml`](../../.github/workflows/cloudflare-preview.yml) — PRs to `dev`/`main` build OpenNext bundle; **optional** isolated preview Worker deploy requires GitHub secrets |
| **GitHub Actions secrets** | `gh secret list -R oumaster369/waia` → **empty** (2026-06-10) — preview Worker deploy **skipped** in CI |
| **Walkthrough Worker** | `waia-app-dee114-walkthrough` — separate config; **out of scope** for this audit |

---

## Supabase Verification

| Check | Finding |
|-------|---------|
| **Linked project (public ref)** | `https://wdsnuvldxyrkqcjxvuxp.supabase.co` — from committed `wrangler.jsonc` `NEXT_PUBLIC_SUPABASE_URL` |
| **Auth public key** | Present in `wrangler.jsonc` as `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key; already committed) |
| **Service role** | Secret name `SUPABASE_SERVICE_ROLE_KEY` present on Worker; **not read by application code** per infrastructure audit |
| **Production parity signal** | Live `GET /api/health/database` → `backend: postgres`, `ok: true` |
| **Dashboard checklist (operator)** | [DEE-59 checklist](DEE-59-SUPABASE-DASHBOARD-CHECKLIST.md) + [DEE-128 Supabase table](DEE-128-PARTNER-PREVIEW-RELEASE-NOTES.md) — last operator-recorded state: Site URL `https://waia.life`, redirects configured; **not re-verified in dashboard during this audit** |
| **Repo migration artifacts** | `db/migrations_postgres/` — journal entries `0000_fast_talisman`, `0001_auth_users_fk`, `0002_useful_machine_man` |
| **Live DB migration apply state** | **Not verified** — requires operator `psql` / Supabase SQL editor against `DATABASE_URL_POSTGRES` |

---

## Environment Parity Assessment

Verified cross-plane facts only:

| Plane | Production-relevant state | Drift vs `dev` tip |
|-------|---------------------------|---------------------|
| **GitHub** | Default branch `dev`; `main` at `536a288`; `dev` at `c0038d3` (+224) | **Expected** — integration ahead of release line |
| **Cloudflare `waia-app`** | Live at `waia.life`; Postgres health OK; deploy version `08166d50` (2026-05-16) | **Code drift** — `dev` contains #161–#163 and 221 other commits not on `main` until promotion |
| **Supabase** | Project ref in `wrangler.jsonc` matches committed production config; Postgres path active in production | **Docs drift** — [`cloudflare-env-vars.md`](../cloudflare-env-vars.md) still marks Supabase Auth as “planned” in places ([`documentation-audit-2026.md`](../documentation-audit-2026.md)) |
| **GitHub Actions** | No repository secrets | Preview Worker deploy disabled; **no hidden auto-deploy to production** observed |

**No hidden environment drift detected** beyond the **documented and expected** `dev`-ahead-of-`main` integration gap and stale operator/doc references.

---

## Findings

1. **Branch lineage is correct** — `main` ⊂ `dev`; no reverse divergence.
2. **Production is live and Postgres-backed** — health endpoint confirms runtime backend.
3. **Latest Worker deployment** is **`08166d50`** (2026-05-16), not the older **`403074cc`** cited in DEE-129 issue text.
4. **Deployment git SHA is not surfaced** by Wrangler list output — attribution work (DEE-150) must use logs/observability, not deploy metadata alone.
5. **GitHub default branch is `dev`** — correct for integration; production policy remains `main` deploy path.
6. **224 commits on `dev` are not on `main`** — includes recovery docs (#161–#162) and Postgres Kit DX (#163); production unchanged until next promotion.
7. **GitHub Actions secrets empty** — PR preview Worker deploys skipped; not a production risk.
8. **Supabase migration apply state on production DB** — not verified in this audit (repo-only evidence).

---

## Risks

| Risk | Severity | Notes |
|------|----------|-------|
| **Production code lags `dev` by 224 commits** | Medium (expected) | Partner-visible behavior reflects `main` deploy, not latest integration |
| **Stale deploy/commit references in issues/docs** | Low | DEE-129 parent cited `daed6bb`/`403074cc`; superseded by `08166d50` |
| **Undocumented production deploy commit** | Low | Blocks precise code↔deploy mapping without dashboard or build logs |
| **Doc/template drift** (Supabase “planned”, SQLite production wording) | Low | Tracked in `documentation-audit-2026.md`; not runtime drift |
| **Supabase migration parity unverified** | Medium (ops) | Requires operator check before assuming schema parity with `db/migrations_postgres` |

---

## Conclusion

DEE-149 acceptance criteria are met:

- [x] Document exists with evidence-based findings
- [x] Production deployment state documented (version id, timestamps, health probe)
- [x] Branch lineage documented (`main` ancestor of `dev`, 0/224)
- [x] Parity risks documented (integration ahead of production, doc drift, migration verify gap)
- [x] No infrastructure changes performed
- [x] Ready to unblock **DEE-150** (production Twin turn latency attribution)

**Recommended next step:** Execute [DEE-150](https://linear.app/deepsense/issue/DEE-150) using Cloudflare observability + `waia_runtime_route` logs on live `waia.life` traffic.

---

## Audit evidence commands

```bash
git fetch origin
git rev-parse origin/main origin/dev
git merge-base --is-ancestor origin/main origin/dev
git rev-list --left-right --count origin/main...origin/dev
npx wrangler deployments list --name waia-app
npx wrangler secret list --name waia-app
curl -sS https://waia.life/api/health/database
gh api repos/oumaster369/waia --jq '{default_branch, pushed_at}'
gh secret list -R oumaster369/waia
```

---

## Document control

| Version | Date | Notes |
|---------|------|-------|
| 1.0 | 2026-06-10 | Initial DEE-149 audit — read-only |
