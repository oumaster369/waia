# ADR-0009 — Regulatory posture for managed trading + performance fees

Status: **Accepted (Posture)**
Date: 2026-06-11
Baseline: v1.2

> **Status state machine.** This ADR has exactly two terminal states:
> - **Accepted (Posture)** — current. External client live trading is **prohibited by policy**.
> - **Accepted (Cleared)** — set only after documented legal/regulatory clearance in target jurisdictions, with human sign-off recorded in the audit stream.
>
> The transition `Accepted (Posture) → Accepted (Cleared)` is the **single switch** that unlocks external live trading. Nothing else may unlock it.

## Context

"Non-custodial managed trading with a 30% performance fee" is, in many jurisdictions, a regulated activity (discretionary asset management / investment advisory), independent of whether the platform holds custody. The source documents treat this as "not legal advice" and otherwise leave it unaddressed. Non-custodial does not remove regulatory exposure, and trade-only API access can still cause client losses. This is an unpriced existential risk if left implicit.

## Decision

Adopt an explicit, conservative regulatory posture:

1. **External client live trading is prohibited by policy, not merely disabled by implementation.** It is forbidden regardless of whether the code, an entitlement, or a feature flag could technically enable it.
2. **No Linear issue, feature, entitlement, workflow, onboarding flow, deployment, or configuration may enable external live trading while this ADR is `Accepted (Posture)`.** External live trading becomes permissible only when this ADR transitions to `Accepted (Cleared)` via documented legal clearance and recorded human sign-off. Any work that would enable it before that transition is out of bounds and must be rejected in planning and review.
3. **MVP live trading is restricted to Org 0 (in-house capital only)** — the platform's own fund — under the admin-gated controls defined in the Master Spec and Roadmap. No external tenant trades live capital in MVP.
4. Clients must explicitly accept risk disclosures and performance-fee terms before any (future, post-clearance) external live activation.
5. The architecture must support future compliance expansion (KYC hooks, jurisdiction gating, reporting) without a rewrite; these are not built in MVP but must not be designed out.
6. This is a non-engineering blocking track owned outside the codebase; it gates the MVP launch and the external-trading transition.

This rule is reflected consistently in the Roadmap (launch gate + Phase 8), MVP Scope (IN/OUT), User Journey (live activation step), and Master Spec (governing decisions + non-negotiable rules).

## Consequences

+ The largest non-technical risk is made explicit and gated, not discovered after launch.
+ The engine can be validated with in-house capital while clearance proceeds.
− External monetization is blocked until clearance — an accepted trade-off.
Neutral: no code is added or removed by this ADR; it constrains *enablement*, not implementation.

## Links

- [AI-TRADER Master Spec v2](../ai-trader/AI-TRADER-MASTER-SPEC-v2.md)
- [AI-TRADER Roadmap v2](../ai-trader/AI-TRADER-ROADMAP-v2.md)
- [ADR-0005 SaaS-as-Superset](0005-saas-as-superset-strategy.md)
