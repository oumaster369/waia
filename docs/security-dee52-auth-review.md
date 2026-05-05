# DEE-52 — Authentication and session security review (MVP)

Short record of what was checked, what changed, and what remains before Cloudflare production traffic.

## Summary

WAIA MVP uses opaque server-side sessions (`sessions` table), an HttpOnly `waia_session` cookie (`sameSite=lax`, `secure` when `NODE_ENV=production`), and `getOptionalSessionUserId()` for dashboard UI and `/api/dashboard/*` handlers. Email sign-in/up and OAuth (Google / Apple PKCE + state, Telegram verified hash) bind identity on the server; OAuth HTTP redirects target only `/` or `/dashboard` under the configured public base URL — no caller-controlled redirect target.

## Verified (unchanged assumptions)

| Area | Status |
| --- | --- |
| Email `/api/auth/sign-in`, `/api/auth/sign-up` — session issuance, timing on missing user | OK |
| `/api/auth/sign-out` — DB delete + cookie clear | OK |
| OAuth callback — PKCE/state, telegram hash | OK |
| Dashboard `/` vs `/dashboard` gating (`layout.tsx`, `page.tsx`) | OK |
| Dashboard APIs — user id **only** from session, not request body/query | OK |
| Cross-user tests (diary, twin-dialogue turns, predictions, scenarios) | Already present |

## Implemented hardening

1. **Client-side post-auth redirect** — `safeInternalRedirectPath` in `lib/landing/safe-internal-redirect.ts` rejects protocol-relative URLs, schemes, traversal, separators, and control characters; `establishEmailAuthSession` in `lib/landing/email-auth-session.ts` fails without calling sign-up when sign-in returns HTTP 200 with an unsafe redirect payload.
2. **Cache semantics** — `headers()` in `next.config.ts` adds `Cache-Control: private, no-store` for `/api/dashboard/:path*` and `/api/auth/:path*` so error responses inherit the same policy as successful JSON (per-route duplicates remain harmless).
3. **Twin engine errors** — `POST /api/dashboard/twin/engine` maps unexpected failures to HTTP 500 with `{ code: "INTERNAL_ERROR" }` and a generic message, without echoing thrown error text.
4. **Tests** — `tests/unit/safe-internal-redirect.test.ts`, extensions in `tests/unit/email-auth-session.test.ts`, `tests/unit/oauth-redirect-response.test.ts`, `tests/unit/twin-engine-route.test.ts`, and Playwright anonymous `/dashboard` guard in `tests/e2e/dashboard.spec.ts`.

## Before deploy (ops)

Set **`OAUTH_PUBLIC_BASE_URL`** (or **`NEXT_PUBLIC_SITE_URL`**) to the real HTTPS origin so OAuth `redirect_uri` and post-OAuth redirects match production. **`Secure`** session cookies require HTTPS in production (`NODE_ENV=production`). Confirm provider secrets (`GOOGLE_*`, `APPLE_*`, `TELEGRAM_BOT_TOKEN`). Optionally tune **`AUTH_SESSION_MAX_AGE_SECONDS`**.
