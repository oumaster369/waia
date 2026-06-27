# WAIA Core M1 — Conformance Record (Org-0)

**Status:** M1 closure record for Pipeline P2 (NEW-3)  
**Effective:** 2026-06-26  
**Scope:** Org-0 operational proof; WC-E1/E2/E4/E5 closure; RBAC deferred Post-MVP

This document is the **conformance record** required by Pipeline P2. It does not redefine architecture — see [WAIA Core Architecture](./WAIA-CORE-ARCHITECTURE.md) and [M1 Deployment Runbook](./WAIA-CORE-M1-DEPLOYMENT-RUNBOOK.md).

---

## 1. Org-0 definition

**Org-0** is the first production personal organization entitled for AI-TRADER on `dev` / staging:

| Attribute | Value |
|-----------|--------|
| Organization kind | `personal` |
| Organization id | Deterministic: `personalOrganizationIdFromUserId(userId)` |
| Entitlement | `organization_entitlements.entitlement_key = 'trader'`, `enabled = true` |
| Trader anchor | `trader_org_profiles` row provisioned at runtime (NEW-4) |
| Operator | Human-maintained trader entitlement grant + verification |

Org-0 is not a separate schema tenant — it uses the same Core tenancy model as all users.

---

## 2. Epic closure matrix (M1)

| Epic | Linear | Capability | Status | Evidence |
|------|--------|------------|--------|----------|
| WC-E1 Profiles | DEE-155 area | `profiles` 1:1 with `users` | **Closed** | `ensureUserCoreSeed*`; backfill CLI |
| WC-E2 Organizations & membership | DEE-157 | Personal org + owner membership | **Closed** | `organizations`, `organization_members`; deterministic org id |
| WC-E4 Subscriptions & entitlements | DEE-159 area | Module entitlements + shadow mode | **Closed** | `organization_subscriptions`, `organization_entitlements`; authoritative reads for trader gate |
| WC-E5 Platform audit | DEE-160 area | Append-only `audit_logs` | **Closed** | SQLite + Postgres triggers; RLS on Postgres (ADR-0007) |
| WC-E6 Scoped access | DEE-190 | `requireOrgContext`, `orgScopedWhere` | **Closed (P2)** | [SCOPED-ACCESS.md](./SCOPED-ACCESS.md) |
| WC-E6 Isolation gate | DEE-191 | Release-blocking CI + deliberate leak probe | **Closed (P2)** | `.github/workflows/ci.yml` `tenant-isolation` job; `*tenant-isolation*.test.ts` |
| WC-E3 RBAC (full) | DEE-158 | Fine-grained roles beyond platform `user`/`admin` | **Post-MVP** | Deferred per Execution Program v2 |

**M1 formally closed** when: this record is merged; Org-0 trader entitlement + runtime provisioning verified; tenant-isolation gate green on `dev`.

---

## 3. Operational invariants (verified)

From [M1 Deployment Runbook §0](./WAIA-CORE-M1-DEPLOYMENT-RUNBOOK.md):

| # | Invariant | Verification |
|---|-----------|--------------|
| I1 | `public.users.id == auth.users.id` | Supabase auth sync |
| I2 | One personal org per user | Deterministic org id; backfill §3b |
| I3 | Personal org owner = user | Provisioning seed |
| I4 | Baseline `twin` subscription + entitlement | `ensureUserCoreSeed*` |
| I5 | `audit_logs` append-only | DB triggers (SQLite `0007`, Postgres `0004`) |
| I6 | No cross-org data access | Application scoping + CI tenant-isolation gate |

Shadow mode remains default (`WAIA_CORE_ENFORCEMENT=0`, `WAIA_CORE_SHADOW=1`) until Architect enables enforcement.

---

## 4. Postgres production posture

| Item | Requirement | Reference |
|------|-------------|-----------|
| Connection role | Privileged service role (`postgres` pooler), not JWT `authenticated`/`anon` | Runbook §1, ADR-0007 |
| Migration apply | Targeted SQL on production; no blind full migrate | ADR-0002, `db/AGENTS.md` |
| RLS | Targeted deny on sensitive tables | Postgres migrations `0004+`, trader `*_rls` migrations |

---

## 5. Automated validation (must be green on `dev`)

```bash
pnpm lint
pnpm typecheck
pnpm test --run
pnpm test --run tenant-isolation
pnpm build
# When Postgres-routed:
WAIA_PG_INTEGRATION=1 pnpm test --run postgres-waia-core-parity
```

---

## 6. Org-0 verification checklist (operator)

- [ ] Org-0 user has `trader` entitlement row enabled.
- [ ] First trader route access creates `trader_org_profiles` row (idempotent re-entry).
- [ ] `trader.org_profile.created` audit event on first provision.
- [ ] Cross-org isolation suites pass (`pnpm test --run tenant-isolation`).
- [ ] No P2 scope drift (RBAC, SQLite parity for new trader code — ADR-0017).

---

## 7. References

- [WAIA Core Architecture](./WAIA-CORE-ARCHITECTURE.md)
- [M1 Deployment Runbook](./WAIA-CORE-M1-DEPLOYMENT-RUNBOOK.md)
- [Scoped Access (WC-E6)](./SCOPED-ACCESS.md)
- [ADR-0007 Targeted RLS](../adr/0007-targeted-rls-strategy.md)
- [AI-TRADER MVP Execution Program v2](../ai-trader/AI-TRADER-MVP-EXECUTION-PROGRAM-v2.md) — Pipeline P2
