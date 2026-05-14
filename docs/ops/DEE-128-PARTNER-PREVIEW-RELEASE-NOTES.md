# DEE-128 — Partner preview release notes (operational)

**Linear:** [DEE-128](https://linear.app/deepsense/issue/DEE-128/partner-preview-release-readiness-dev-main-waialife)  
**Scope:** Release discipline for **`dev` → `main` → `waia.life`**. Not conversational research (DEE-127 stays walkthrough-only).

---

## Repository alignment (this PR)

- **[`wrangler.jsonc`](../wrangler.jsonc)** (production Worker **`waia-app`** only): `NEXT_PUBLIC_SITE_URL` and **`OAUTH_PUBLIC_BASE_URL`** set to **`https://waia.life`** so committed config matches partner-preview origin and OAuth callback base ([`lib/oauth/public-url.ts`](../lib/oauth/public-url.ts)).
- **Unchanged:** [`wrangler.dee114-walkthrough.jsonc`](../wrangler.dee114-walkthrough.jsonc), prompt stack, model/sampling code paths.

---

## Operator preflight (manual — recorded without secrets)

### Cloudflare `waia-app`

| Check | Status (operator) |
|-------|-------------------|
| Custom domain **`waia.life`** | Done |
| Production Worker **`waia-app`** | Done |
| Production branch **`main`** | Policy |
| **`WAIA_DB_BACKEND=postgres`** | Done |
| **`DATABASE_URL_POSTGRES`** secret | Done |
| **`SUPABASE_SERVICE_ROLE_KEY`** secret | Done |
| **`WAIA_AI_OPENAI_API_KEY`** secret | Done |
| Legacy **`OPENAI_API_KEY`** | Present — **do not remove** without Architect charter |
| **`OAUTH_PUBLIC_BASE_URL`** in dashboard | Was missing — **set via this PR’s `wrangler.jsonc`** on next deploy (or mirror in dashboard) |
| **`NEXT_PUBLIC_SITE_URL`** | Was workers.dev — **aligned to `https://waia.life` in this PR** |

**Rollback baseline (recorded):**

- Active Worker version id before latest secret add: **`ec672151`** (change: add `WAIA_AI_OPENAI_API_KEY`; traffic 100%; error rate 0%).
- Previous code deploy reference: version **`2038dd19`**, commit **`6b75ba9`**, PR **`#145`**.

### Supabase `waia-prod`

| Check | Status (operator) |
|-------|-------------------|
| Site URL **`https://waia.life`** | Done |
| Redirect URLs include **`https://waia.life/**`** | Done |
| Email provider enabled | Done |
| New user signup enabled | Done |
| Confirm email | **OFF** for partner-preview |
| Localhost / workers.dev redirects | Intentionally left for now |

---

## Remaining gates (human)

1. Merge **DEE-128** env-alignment PR to **`dev`**, then promotion **`dev` → `main`** per governance.
2. **CI green** on promotion PR: lint, typecheck, tests, build, e2e (see `.github/workflows/ci.yml`).
3. **Production deploy** of `waia-app` from `main` with **`pnpm cloudflare:build`** + **`wrangler deploy`** (or CI equivalent).
4. **Smoke:** signup, sign-in, dashboard, Twin dialogue, `GET /api/health/database`, logout, redirect sanity on **`https://waia.life`**.
5. **DEE-128** comment: post-deploy version id + smoke outcome (no secrets).

---

## Deferred product note (not in this PR)

**“Your Name” on homepage/signup** — align with Supabase Auth user metadata / name column for first Twin experience. **Separate lightweight frontend issue** recommended unless already trivially present.

---

## Document control

| Version | Notes |
|---------|--------|
| 1.0 | DEE-128 partner-preview operator log + remaining gates. |
