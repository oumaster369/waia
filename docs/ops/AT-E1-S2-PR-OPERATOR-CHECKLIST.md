# AT-E1 S2 — PR operator checklist

Attach this checklist to the implementation PR. **Agents do not perform production Cloudflare or Supabase changes.**

## Code delivered (agent)

- [ ] `lib/hosts/` module-host abstraction (`resolveModuleHost`, `buildModuleUrl`)
- [ ] Topology-only host routing: `next.config.ts` cross-host redirects + module-classification `middleware.ts` (no session/DB/authz)
- [ ] Host-aware landing, trader layout, sign-in redirects (no `/` → `/trader` rewrite)
- [ ] Optional `WAIA_COOKIE_DOMAIN` guard (production-only, reversible)
- [ ] Unit + E2E host-header tests
- [ ] Docs: [cloudflare-deploy.md](../cloudflare-deploy.md), [cloudflare-env-vars.md](../cloudflare-env-vars.md)

## Validation (agent)

```bash
pnpm lint
pnpm typecheck
pnpm test --run
pnpm build
# optional Workers smoke:
pnpm cloudflare:preview
```

## Production operations (human — after merge to dev / before prod)

- [ ] DNS: `trader.waia.life` → `waia-app` Worker
- [ ] Cloudflare: custom domain `trader.waia.life` on existing Worker
- [ ] Worker env: `NEXT_PUBLIC_TRADER_URL=https://trader.waia.life`, `WAIA_TRADER_HOST=trader.waia.life`
- [ ] Supabase Redirect URLs: `https://trader.waia.life/**` (Site URL stays `https://waia.life`)
- [ ] Smoke: sign in on trader host → `/trader` workspace for entitled user
- [ ] (Optional) `WAIA_COOKIE_DOMAIN=.waia.life` — only if enabling seamless subdomain sessions

## Explicitly out of scope

- Partner-domain SSO (future redirect/token design)
- `twin.waia.life` / `society.waia.life` / `3p.waia.life` subdomains
- Trader domain schema (DEE-193)

## Risk tier

**T3** — routing + optional cookie touch + production DNS/custom-domain ops.
