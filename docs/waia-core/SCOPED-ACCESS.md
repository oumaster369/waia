# WAIA Core — Scoped Access (WC-E6 / DEE-190)

**Status:** Implemented (Pipeline P2)  
**ADR:** [ADR-0007 Targeted RLS Strategy](../adr/0007-targeted-rls-strategy.md)

Mandatory org-scoped data access for all module code paths touching tenant-owned rows.

---

## 1. Application-layer helpers

| Helper | Location | Purpose |
|--------|----------|---------|
| `requireOrgContext(organizationId)` | `lib/waia-core/scope/org-context.ts` | Rejects empty/missing org id (`OrgScopeError`) |
| `orgScopedWhere(column, context)` | same | Builds mandatory `eq(organizationId, context.organizationId)` predicate |
| `assertOrgMembershipSqlite` / `assertOrgMembershipPostgres` | same | Verifies user belongs to org before sensitive operations |

**Rule:** Every org-owned read/write must receive an explicit `OrgContext` from auth/session resolution — never infer org from unvalidated client input alone.

---

## 2. Postgres RLS (defense-in-depth)

Sensitive tables deny Supabase JWT roles (`authenticated`, `anon`) direct access. Service-layer Drizzle writes use a privileged connection role (see [M1 Runbook §1](./WAIA-CORE-M1-DEPLOYMENT-RUNBOOK.md)).

Trader tables with RLS migrations include: `exchange_credentials`, `trader_risk_limits`, `trader_kill_switches`, order domain, MI layers, billing/settlement, payments — see [`db/AGENTS.md`](../../db/AGENTS.md) migration table.

SQLite (local MVP): org isolation enforced at application layer + CI gate; no RLS.

---

## 3. Module adoption

Trader repositories and services call `requireOrgContext` at entry (examples):

- `lib/trader/credentials/*`
- `lib/trader/settlement/*`
- `lib/trader/risk/*`
- `lib/trader/execution/*`
- `lib/trader/intelligence/*` (MI services)

New trader code **must** follow the same pattern (Postgres-only per ADR-0017).

---

## 4. Verification

```bash
pnpm test --run tenant-isolation
```

Release-blocking gate: `.github/workflows/ci.yml` job `tenant-isolation`.

Deliberate leak probe: `tests/unit/tenant-isolation-deliberate-leak-probe.test.ts`.
