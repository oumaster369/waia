# DEE-59 — Supabase dashboard checklist (operator)

Complete these steps **before** relying on `NEXT_PUBLIC_SUPABASE_*` in Workers or closing [DEE-59](https://linear.app/deepsense/issue/DEE-59).

1. Open the Supabase project for WAIA.
2. **Authentication → Providers → Email** — enable Email provider; configure confirmation email behavior (disable confirmation for dev/staging smoke if the program wants immediate sign-in).
3. **Authentication → URL configuration**
   - **Site URL:** production origin (e.g. `https://waia.life`).
   - **Redirect URLs:** include local dev, staging Worker origin, and production. Include OAuth callback paths when OAuth is migrated later (`/api/auth/oauth/.../callback` per app routes).

4. Copy **Project URL** and **anon key** into deployment env as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`).

5. **Architect decision (oauth-gap):** Until a Supabase OAuth slice ships, run **DEE-79 §9** authenticated smoke using **email/password** on the landing flow; Google OAuth routes still use legacy SQLite and fail on Workers.

6. **Twin DB (twin-db):** Email auth no longer requires `getDb()` for session resolution when Supabase env is set. Twin dialogue persistence still uses [`getWaiaRuntimeDb()`](../../db/waia-runtime-db.ts); on Workers, set `WAIA_DB_BACKEND=postgres` and `DATABASE_URL_POSTGRES` (or equivalent) for full dialogue persistence—separate from DEE-59.

**Do not** paste service role keys into Linear or public tickets.
