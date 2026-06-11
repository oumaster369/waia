# AI-TRADER Integration

Status: Baseline v1.2
Date: 2026-06-11

AI-TRADER is not a standalone product. It is a WAIA module with a dedicated entry point (`trader.waia.life`) that attaches to WAIA Core like every other module. This document defines its relationships with Core, AI-TWIN, and future 3P / AI-Marketplace modules.

It is subordinate to [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md). Where they disagree, Core wins.

---

## 1. Relationship with WAIA Core

### 1.1 Shared, not duplicated

AI-TRADER **must use** Core for:

- authentication and authorization (Supabase Auth; `public.users.id == auth.users.id`);
- `profiles`, `organizations`, `organization_members`;
- roles, permissions, entitlements, subscriptions;
- the shared payer identity and crypto payment ledger;
- the platform audit stream.

No trader-specific user or organization tables may exist.

> Reality note: these Core domains do not yet exist in the codebase. The Phase 1 Core uplift (see [Roadmap v2](AI-TRADER-ROADMAP-v2.md)) is a **hard platform prerequisite** for AI-TRADER, not a trader feature phase. **AI-TRADER development begins only after the WAIA Core Uplift is complete.** No trader domain table, route, or service may be built before Core identity, tenancy, entitlements, and the audit stream exist.
>
> **The Core Uplift is a live migration, not greenfield.** AI-TWIN is already in production, so the Uplift runs as a platform-migration program: migration planning, tested rollback per step, AI-TWIN continuity (existing users backfilled with zero behavioral change), and backward compatibility (`public.users.id == auth.users.id` preserved, additive-only on tables AI-TWIN reads). See [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md) and [ADR-0002](../adr/0002-staged-postgres-runtime-rollout-discipline.md).

### 1.2 Entry points, one identity

- **Main WAIA (`waia.life`):** the user opens the WAIA cabinet and reaches AI-TRADER from the sidebar.
- **Dedicated portal (`trader.waia.life`):** the user enters the AI-TRADER experience directly and sees only trader functionality.
- Authentication is identical across both. A user registered through either domain is the same `auth.users` / `public.users` record.

### 1.3 Tenancy and attribution

- Every trader row carries `organization_id`.
- Partner deployments (e.g. `trader.partner-domain.com`) and the in-house fund map to organizations with no schema change — satisfying partner attribution at the organization level.

### 1.4 Module access

A user may use AI-TWIN only, AI-TRADER only, or both. Module availability is governed by Core `entitlements`; the trader route group is reachable only when the organization holds the `trader` entitlement.

### 1.5 Administration

WAIA platform admins (Core `admin` role) have cross-module oversight of all AI-TRADER data: accounts, exchange connections, positions, orders, invoices, risk events, and strategy states, through a centralized admin console. All admin actions are written to the shared audit stream.

---

## 2. Relationship with AI-TWIN

- **Independent domains, shared identity.** AI-TWIN owns `twin_profiles`, dialogue, diary, readiness; AI-TRADER owns exchange/market/strategy/order/billing domains. Neither reads the other's tables.
- **No behavioral coupling in MVP.** AI-TWIN does not influence trading decisions and AI-TRADER does not feed the twin. Any future "twin-informed risk preference" is explicitly out of MVP scope and would be mediated through an explicit, audited Core-level contract — never direct table access.
- **Shared UX shell.** Both modules render the same identity/profile and live under the same WAIA navigation and design system.

### 2.1 Future interaction principles (non-MVP — boundaries only)

This subsection defines architectural boundaries for any *future* AI-TWIN ↔ AI-TRADER interaction. It introduces **no features** and changes no MVP behavior; behavioral coupling remains prohibited in MVP. If such interaction is ever proposed, it must obey these principles:

1. **No direct table access.** Neither module may read or write the other's tables under any circumstance.
2. **Core-mediated contracts only.** Any data exchange flows through an explicit, versioned contract mediated by WAIA Core — never module-to-module coupling.
3. **Explicit auditing.** Every cross-module data flow is recorded in the shared audit stream (what was shared, by whom, for which organization, under which contract).
4. **Explicit user consent where applicable.** Any use of AI-TWIN personal/behavioral data to influence trading (or vice versa) requires explicit, revocable user consent, recorded and auditable.
5. **No safety bypass.** A cross-module signal may never override the Chief Decision Engine, Risk Engine, kill switches, or the manual billing gate.

These are guardrails to prevent future coupling from being introduced informally. They do not authorize any specific feature.

---

## 3. Future relationship with 3P (Provision / Promotion / Production)

- 3P will attach to Core identically: organization-scoped, entitlement-gated, audited.
- Potential future touchpoints (not committed): treating a business organization as a trading tenant, or surfacing trader performance as a business capability. These remain conceptual and must not constrain MVP architecture.

---

## 4. Future relationship with AI-Marketplace

- AI-Marketplace is the economic/marketplace layer and will also attach to Core.
- Potential future touchpoints (not committed): listing validated strategies or performance products, or routing marketplace settlement through the shared payment ledger.
- The shared payer identity and payment infrastructure (owned by Core) is intentionally generalized so marketplace and trader can both consume it later without rework.

---

## 5. Integration invariants

1. Identity and tenancy belong to Core; modules reference them by foreign key only.
2. Modules consult Core entitlements before exposing functionality.
3. Cross-module data flows, if ever introduced, go through explicit Core-mediated contracts — never direct cross-module table access.
4. Payment/payer concerns route through Core shared infrastructure.
5. Every sensitive action writes to the shared audit stream.

---

## Related documents

- [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md)
- [AI-TRADER Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md)
- [AI-TRADER Billing & HWM](AI-TRADER-BILLING-HWM.md)
