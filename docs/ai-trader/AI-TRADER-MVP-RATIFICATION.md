# AI-TRADER MVP — Architecture Ratification & Scope-Freeze Charter

Status: **RATIFIED** — Step 10 complete (2026-06-29)  
Type: Closure seal (declarative; creates no new rule)  
Implementation baseline (`dev`): `2071130bfeefb90a28f97294abca6af158fe1177` (PR #318)  
Documentation closure (`dev`): `cb48863c8334e7b474ac3aa461ac1926076f9bb3` (PR #319)  
Authority: Founders Council apex ([ADR-0012](../adr/0012-governance-integration-founders-council-and-english-canon.md)) · Single Operator Governance Model ([ADR-0011](../adr/0011-single-operator-governance-model.md))

> **This document creates no new rule.**  
> **It ratifies already approved architecture.**  
> **It freezes the shape of the completed AI-TRADER MVP.**
>
> It **supersedes nothing**. Where this charter appears to disagree with an authoritative source, the authoritative source wins and this charter is corrected. Authoritative sources remain:
>
> - [AI-TRADER Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md)
> - [AI-TRADER MVP Scope v2](AI-TRADER-MVP-SCOPE-v2.md)
> - [ADRs](../adr/README.md) (AI-TRADER: ADR-0005 … ADR-0017)
> - [DEE-352 BP-9A Verification Report](../ops/DEE-352-BP9A-MVP-VERIFICATION-REPORT.md)
> - [DEE-352 Launch Readiness Review](../ops/DEE-352-LAUNCH-READINESS-REVIEW.md)
>
> This charter may be amended only by a new ADR that explicitly references and supersedes the relevant clause.

---

## 1. Purpose

This charter formally closes the AI-TRADER MVP architecture.

It exists to convert a completed body of work into a single, timeless reference point: a statement of *what the AI-TRADER MVP is*, *what it deliberately is not*, and *which principles must remain true* as the system evolves.

It is written for future engineers, agents, and operators who will extend AI-TRADER long after the MVP context is forgotten. When a future change asks "was this part of the MVP?" or "is this invariant negotiable?", this document answers without ambiguity. From ratification onward, this is the architectural datum against which all AI-TRADER evolution is measured.

It is **not** a specification, an ADR, a verification report, or an implementation guide. Evidence of completion lives in the BP-9A Verification Report and Launch Readiness Review. This charter records meaning, not proof.

---

## 2. What the AI-TRADER MVP officially is

AI-TRADER is a **non-custodial market-intelligence and trading module** of the WAIA ecosystem. It detects market regimes, permits trading only when edge exceeds cost and risk, and acts on client-owned exchange accounts through trade-only access. Its defining capability is restraint: **the system can always choose not to trade.**

Architecturally, the MVP is the smallest safe expression of a larger institutional ambition, built so that the seed never has to be torn out to grow. It is defined by the following architectural commitments (see [Vision](AI-TRADER-VISION.md) and [Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md)):

- **Control Plane / Execution Plane separation.** The Cloudflare Worker is the control plane. Live order execution belongs to a separate, off-Cloudflare execution plane (Option B). The two never merge.
- **Slow state vs fast execution.** Supabase is the source of truth, memory, audit, billing, and configuration. Execution state is fast and in-memory. Trading-critical decisions never depend on UI workflows.
- **The Org-0 model.** Live capital in the MVP is in-house capital only. AI-TRADER is proven on the platform's own fund before any external party is ever exposed.
- **Fail-closed philosophy.** Missing configuration, degraded data, or triggered kill switches deny the unsafe path by default, at every level.
- **Validation before promotion.** No strategy reaches live — even Org-0 live — without a signed promotion record proving edge, not merely working plumbing ([ADR-0010](../adr/0010-strategy-validation-gate.md)).
- **Human authority over capital.** AI-TRADER amplifies human judgment; it never replaces it. A human is always above the system, holds custody, and can revoke.
- **Governance-first architecture.** Auditability, reproducibility, and explicit authorization are first-class product properties, designed in — not retrofitted.

---

## 3. Official MVP scope

The following are ratified as **in** the completed AI-TRADER MVP (see [MVP Scope v2](AI-TRADER-MVP-SCOPE-v2.md)):

- **WAIA Core foundation** — shared identity, tenancy, roles, entitlements, payer identity, and the single platform audit stream; the `trader` entitlement gates module access.
- **HTX integration** — HTX only, spot only (BTCUSDT, ETHUSDT); READ + TRADE credentials encrypted at rest; withdraw/transfer permissions rejected or treated as unsafe.
- **Market Brain / Market Intelligence** — ingestion for BTC/ETH spot plus Fear & Greed and news sentiment, producing the Market State Vector with a data-quality score.
- **Chief Decision Engine (CDE)** — a regime and trading-permission gate that can decline to trade; it never places orders.
- **Two whitelisted strategies** — Liquidity Sweep Reversal and Mean Reversion; deterministic; signal-emitting only.
- **Risk Engine & kill switches** — hard limits and fail-closed kill switches at global, user, account, strategy, and instrument levels; idempotent order state machine and reconciliation.
- **Paper trading** — end-to-end via Accelerated Historical Replay, the default and proving mode.
- **Strategy Validation Gate** — the governed paper→live boundary ([ADR-0010](../adr/0010-strategy-validation-gate.md)).
- **Org-0 admin-gated live spot** — capped, single supervised account, in-house capital only, under the Single Operator Governance Model ([ADR-0011](../adr/0011-single-operator-governance-model.md)).
- **Billing, HWM & manual gate** — monthly periods, per-account high-water mark, 30% fee on net new realized profit; draft invoices issued only after manual reconciliation sign-off ([ADR-0008](../adr/0008-manual-billing-gate.md)).
- **Payment registry & settlement** — USDT TRC-20 deposit-address registry ([ADR-0013](../adr/0013-payment-address-registry-wallet-anchored-event-sourced-soft-bound.md)), read-only payment watcher ([ADR-0014](../adr/0014-payment-watcher-execution-model-read-only-observer.md)), Tron finality/RPC trust doctrine ([ADR-0015](../adr/0015-tron-settlement-finality-rpc-trust-doctrine.md)), and settlement exception reconciliation ([ADR-0016](../adr/0016-settlement-exception-reconciliation.md)).
- **Telegram alerting** — inline alert router on existing telemetry; dedicated alert secrets; non-blocking delivery.
- **Execution Host** — isolated off-Cloudflare scaffold for the bounded live CLI path (Option B).
- **Admin Console** — cross-module administration and controls over an append-only audit trail.
- **Persistence posture** — Postgres-only for new trader MVP code ([ADR-0017](../adr/0017-postgres-only-trader-mvp.md)); application-enforced access control with targeted RLS as defense-in-depth ([ADR-0007](../adr/0007-targeted-rls-strategy.md)); single repository ([ADR-0006](../adr/0006-ai-trader-repository-strategy.md)).

If a capability is not listed above, it is **not** part of the MVP.

---

## 4. Explicitly NOT part of the MVP

The following are intentionally and permanently excluded from the AI-TRADER MVP (see [MVP Scope v2](AI-TRADER-MVP-SCOPE-v2.md) OUT and FUTURE sections). Adding any of them is **new product scope**, not MVP completion, and requires its own authorization.

- **External client live trading** — prohibited by policy until [ADR-0009](../adr/0009-regulatory-posture.md) transitions from `Accepted (Posture)` to `Accepted (Cleared)`.
- **Multi-exchange support** — additional venues are future, not MVP.
- **Multi-tenant production rollout** — the MVP proves on Org-0; broad tenant onboarding to live capital is future.
- **Futures, margin, options, and high-frequency execution.**
- **Portfolio / fund / prop-firm management** — beyond a trivial constant allocator (data model only).
- **Autonomous, reinforcement-learning, or self-modifying strategy generation.**
- **Automated research** — backtesting / walk-forward automation and automated strategy-health (schema + manual lifecycle only in MVP).
- **Future Context Layer beyond a stub.**
- **Additional symbols beyond BTC/ETH.**
- **Mobile applications.**
- **Institutional custody** — AI-TRADER is and remains non-custodial.
- **Advanced optimization and performance scaling** — including graduation of the payment watcher or execution path to a persistent off-Cloudflare daemon.
- **Cross-exchange arbitrage and market making.**
- **Cross-module integration** with AI-TWIN social, Business/3P, or AI-Marketplace.

---

## 5. Architectural invariants

These principles must remain true unless explicitly overturned by a ratified ADR. They are the constitutional core; violating one is an architectural regression regardless of any feature benefit (see [Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md) governing decisions and hard rules).

1. **Worker = Control Plane.** Cloudflare hosts UI, light APIs, slow-state writes, health, and the read-only payment watcher — never the execution engine, persistent exchange sessions, or the fast order path.
2. **Execution Host = Execution Plane.** Live order execution runs off-Cloudflare (Option B), with its own secret-injection path.
3. **Slow state vs fast execution.** Supabase is truth and memory; it is never a low-latency execution bus.
4. **Fail closed.** Absence of safety is denial of action.
5. **No uncontrolled execution.** No Worker live order placement; every live path is admin-gated, capped, and audited.
6. **Validation before promotion.** Edge must be proven and signed before live.
7. **Human authority over capital.** Non-custodial; READ + TRADE only; WITHDRAW/TRANSFER forbidden; a human is always above the system.
8. **Governance before automation.** Authorization, cooling-off, and immutable audit precede any sensitive automated action.
9. **Reality-first engineering.** Decisions are reproducible from stored context; the system proves rather than predicts.
10. **Single source of truth.** WAIA Core owns identity, tenancy, entitlements, payer identity, and audit; modules reference Core by foreign key and never redefine its domains ([WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md)).
11. **No duplicate runtime.** No second scheduler, daemon, websocket loop, or parallel execution FSM beyond the approved cron + host.
12. **Org-0 first.** In-house capital is the only live capital until ADR-0009 is cleared.
13. **Modules are vertical; the platform is horizontal.** A module owns its tables and never reads or writes another module's.
14. **Additive evolution.** Architecture grows by additive, reversible steps that do not destabilize the live platform.

---

## 6. What BP-10 represents

BP-10 (Linear [DEE-340](https://linear.app/deepsense/issue/DEE-340)) is **launch authorization, not implementation.**

The AI-TRADER MVP is architecturally and functionally complete at the canonical `dev` commit recorded above. BP-10 adds no feature, no exchange, no strategy, and no runtime. It is the governed act of:

- confirming the full MVP checklist is green on `main`;
- executing the **first capped, supervised Org-0 live spot order** under the Single Operator Governance Model;
- promoting `dev → main` and performing the mandatory back-sync.

BP-10 does not alter scope or invariants. ADR-0009 remains `Accepted (Posture)` throughout: launching the MVP does **not** unlock external live trading. BP-10 is a decision and a ceremony, gated on this ratification — not a build phase.

---

## 7. Future evolution

Everything below is **post-MVP product evolution**, cleanly separated from the ratified MVP (see [MVP Scope v2](AI-TRADER-MVP-SCOPE-v2.md) FUTURE and [Roadmap v2](AI-TRADER-ROADMAP-v2.md)). Each requires its own scoping, ADRs where policy shifts, and authorization. None is implied by MVP completion.

- **Version 2 surface** — additional exchanges and symbols by configuration.
- **External & multi-tenant rollout** — permissible only after ADR-0009 → `Accepted (Cleared)` with recorded legal sign-off.
- **Scaling & runtime graduation** — persistent off-Cloudflare execution daemon when volume or latency demands it.
- **Institutional capabilities** — portfolio, fund, prop-firm, and partner structures; institutional reporting.
- **Intelligence advancement** — richer Future Context, automated research and strategy-health, parameter adaptation within validated bounds.
- **Ecosystem integration** — bridges to AI-TWIN, Business/3P, and AI-Marketplace.

The MVP architecture is the seed of this future and must not be rewritten to reach it — only extended along the invariants above.

---

## 8. Ratification

This charter is ratified when the signatures below are recorded. Upon ratification it becomes immutable; it may thereafter be amended **only** by a new ADR that explicitly references and supersedes the relevant clause.

| Role | Authority | Name | Date | Signature |
|------|-----------|------|------|-----------|
| Chief Architect | Founders Council apex (ADR-0012) | Adamar / Architect-Operator | 2026-06-29 | Step 10 ratification — BP-9A closure |
| Single Operator | ADR-0011 governed authority | Adamar / Architect-Operator | 2026-06-29 | Step 10 ratification — BP-9A closure |

**Ratification record**

| Field | Value |
|-------|-------|
| Implementation baseline (`dev`) | `2071130bfeefb90a28f97294abca6af158fe1177` (PR #318) |
| Documentation closure (`dev`) | `cb48863c8334e7b474ac3aa461ac1926076f9bb3` (PR #319) |
| BP-9A verification | **11/11 PASS** — Steps 1–9A + Step 10 complete (2026-06-29) |
| `WAIA_CORE_ENFORCEMENT` | **OFF** (unset on production Worker; application-layer enforcement primary per ADR-0007) |
| Effect of signature | AI-TRADER MVP architecture **CLOSED**; scope **FROZEN**; BP-10 launch authorization **unblocked** |

**Canonical references:** [Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md) · [MVP Scope v2](AI-TRADER-MVP-SCOPE-v2.md) · [Implementation Program v1.2](AI-TRADER-IMPLEMENTATION-PROGRAM.md) · [Vision](AI-TRADER-VISION.md) · [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md) · [ADRs](../adr/README.md) · [BP-9A Verification Report](../ops/DEE-352-BP9A-MVP-VERIFICATION-REPORT.md) · [Launch Readiness Review](../ops/DEE-352-LAUNCH-READINESS-REVIEW.md)
