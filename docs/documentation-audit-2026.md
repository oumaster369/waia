# Documentation audit — 2026

Findings from onboarding doc review and template drift analysis. **Not** an onboarding guide — see [`GETTING-STARTED.md`](GETTING-STARTED.md) for setup.

**Related:** [`waia-governance/WAIA-INFRASTRUCTURE-PARITY-AUDIT-2026.md`](waia-governance/WAIA-INFRASTRUCTURE-PARITY-AUDIT-2026.md) · [`waia-governance/WAIA-RECOVERY-2026.md`](waia-governance/WAIA-RECOVERY-2026.md)

---

## `.env.example` — proposed updates

| Location | Current (stale) | Proposed change |
|----------|-----------------|-----------------|
| Line 13 | “Supabase Auth (planned; wire-up is tracked outside…)” | **Active in production** when `NEXT_PUBLIC_SUPABASE_*` are set; optional locally |
| Line 30 | “production remains SQLite unless you explicitly set WAIA_DB_BACKEND” | **Production uses `WAIA_DB_BACKEND=postgres`** per `wrangler.jsonc` |
| Line 85 | Example model `gpt-4o-mini` | Note production uses **`gpt-5.5`** in `wrangler.jsonc`; local may use any compatible model |
| Line 104–107 | `OPENAI_API_KEY` deferred section | Add explicit note: **Twin gateway does not read this key**; use `WAIA_AI_OPENAI_API_KEY` |
| Missing | — | Add short **“Development modes A/B/C”** pointer to [`GETTING-STARTED.md`](GETTING-STARTED.md) (**done** in onboarding guide) |

---

## `.dev.vars.example` — proposed updates

| Gap | Proposed change |
|-----|-----------------|
| Missing entire `WAIA_AI_*` block | Add commented mirror of `wrangler.jsonc` plain vars + `WAIA_AI_OPENAI_API_KEY` placeholder |
| Line 16–20 | “planned … until SSR wiring exists” | **SSR auth is wired** — update to “required for Mode C / production parity” |
| Line 42 | Only `OPENAI_API_KEY` (legacy) | Replace with **`WAIA_AI_OPENAI_API_KEY`**; keep `OPENAI_API_KEY` as deprecated comment |
| Missing | `WAIA_TWIN_DIALOGUE_CONTINUITY`, `WAIA_AI_OPENAI_MODEL`, etc. | Add from `wrangler.jsonc` |
| `SUPABASE_SERVICE_ROLE_KEY` | Mark **optional / unused by app code** today |

---

## Other docs with known drift

| Document | Issue | Proposed action |
|----------|-------|-----------------|
| [`postgres-development.md`](postgres-development.md) | “Production app still SQLite by default” in honest-current-state table | Update to **`WAIA_DB_BACKEND=postgres` on Worker** |
| [`supabase-auth-postgres.md`](supabase-auth-postgres.md) | Older wording implies Supabase not fully wired | Clarify Auth **is** wired; service role not used in code |
| [`cloudflare-env-vars.md`](cloudflare-env-vars.md) | Lists `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` as critical | Annotate: present on Worker / **not read by Twin gateway or app** |
| [`README.md`](../README.md) | Was pointer hub only | **Done** — see Getting Started section |

---

## Legacy env names (canonical truth)

Canonical list for onboarding — [`GETTING-STARTED.md`](GETTING-STARTED.md) links here instead of duplicating.

| Name | Status |
|------|--------|
| `WAIA_AI_OPENAI_API_KEY` | **Required** for live Twin dialogue (Mode B/C and production) |
| `OPENAI_API_KEY` | Legacy Worker secret; **not read** by Twin gateway or current app code |
| `SUPABASE_SERVICE_ROLE_KEY` | May exist on Worker; **not read** by application code today |

---

## Test count references

Onboarding docs previously cited **496+** unit tests and **~38** Postgres integration tests without an “as of” date. Re-verify against `pnpm test --run` and `WAIA_PG_INTEGRATION=1` before citing hard numbers in docs.
