# ADR-0005 — SaaS-as-Superset strategy (fund as first tenant)

Status: Accepted
Date: 2026-06-11

## Context

The AI-TRADER source documents conflict on product identity. `AI-TRADER_EN` frames an internal single-tenant PROP fund engine ("no team, no investors"), while the master spec, integration, and business documents describe a multi-tenant non-custodial managed-trading SaaS with per-user invoicing and a 30% performance fee. These imply opposite MVP priorities (a single-tenant fund needs no RLS, invoicing, payment watcher, or suspension lifecycle; a SaaS needs all of them).

## Decision

Build the **multi-tenant SaaS architecture**, and run the **in-house fund as the first tenant ("Org 0")**. The PROP-fund framing becomes a *deployment posture* on the SaaS foundation, not a separate product. First live capital is the in-house fund's own; external onboarding (account access and paper trading) becomes an entitlement flag, not a rearchitecture.

> Scope clarification: "external onboarding becomes an entitlement flag" refers to module *access* and *paper* usage only. It does **not** authorize external **live** trading, which is prohibited by policy under [ADR-0009](0009-regulatory-posture.md) until that ADR is `Accepted (Cleared)`. No entitlement may bypass ADR-0009.

## Consequences

+ One architecture serves both the fund and future external clients; no rebuild when onboarding begins.
+ The engine is validated with in-house capital before external exposure.
+ Organization/tenancy is required from day one (drives the WAIA Core uplift).
− Slightly more upfront work than a single-tenant fund.
Neutral: regulatory exposure is unchanged by this decision and is handled in ADR-0009.

## Links

- [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md)
- [AI-TRADER Master Spec v2](../ai-trader/AI-TRADER-MASTER-SPEC-v2.md)
