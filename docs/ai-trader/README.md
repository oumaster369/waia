# AI-TRADER — documentation corpus

Status: Baseline v1.2 (governing) · Date: 2026-06-11

AI-TRADER is a **module of WAIA** (market intelligence + managed trading) reachable at `trader.waia.life`. It attaches to **WAIA Core** for identity, tenancy, entitlements, payments, and audit. This README is the navigation index for the AI-TRADER corpus — it routes, it does not redefine.

> **Authority order:** [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md) wins over any module document. Within AI-TRADER, the [Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md) is the governing technical specification; subject-owner docs (Security, Billing & HWM) are authoritative for their subject. Decisions are recorded as [ADRs](../adr/README.md) (AI-TRADER decisions = **ADR-0005 … ADR-0011**).

---

## Reading order

| # | Document | Role |
|---|----------|------|
| 1 | [AI-TRADER Vision](AI-TRADER-VISION.md) | Purpose, philosophy, long-term direction (no timelines/budgets). |
| 2 | [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md) | Shared platform AI-TRADER depends on (read before the spec). |
| 3 | [AI-TRADER Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md) | **Governing technical specification** (architecture + contracts; no code). |
| 4 | [AI-TRADER MVP Scope v2](AI-TRADER-MVP-SCOPE-v2.md) | What is IN / OUT (HTX-only, spot-only, paper-first). |
| 5 | [AI-TRADER Roadmap v2](AI-TRADER-ROADMAP-v2.md) | Governing build sequence (Core uplift first, safety spine pulled forward). |
| 6 | [AI-TRADER Implementation Program](AI-TRADER-IMPLEMENTATION-PROGRAM.md) | **Program v1.1** — execution blueprint (Milestones / Epics / Feature Groups) that drives Linear. |
| 7 | [AI-TRADER Security](AI-TRADER-SECURITY.md) | Binding security model (credentials, key management, kill switches, audit). |
| 8 | [AI-TRADER Billing & HWM](AI-TRADER-BILLING-HWM.md) | Single source of truth for fees / high-water mark. |
| 9 | [AI-TRADER Integration](AI-TRADER-INTEGRATION.md) | Relationships with Core, AI-TWIN, future modules. |
| 10 | [AI-TRADER User Journey v2](AI-TRADER-USER-JOURNEY-v2.md) | End-to-end user flow for the reconciled MVP. |
| 11 | [AI-TRADER Market Intelligence Architecture](AI-TRADER-MARKET-INTELLIGENCE-ARCHITECTURE.md) | **Accepted doctrine** (2026-06-22) — knowledge-first Market Intelligence architecture; peer of the Grandmaster Framework, subordinate + additive to the Master Spec and ADRs. |

---

## Authoritative sources

- **Governing technical spec:** [AI-TRADER Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md) (Baseline v1.2).
- **Platform foundation (wins on conflict):** [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md).
- **Execution blueprint:** [AI-TRADER Implementation Program v1.1](AI-TRADER-IMPLEMENTATION-PROGRAM.md).
- **Decisions:** [ADR index](../adr/README.md) — AI-TRADER spans **[ADR-0005](../adr/0005-saas-as-superset-strategy.md) … [ADR-0011](../adr/0011-single-operator-governance-model.md)**.
- **Subject owners:** [Security](AI-TRADER-SECURITY.md), [Billing & HWM](AI-TRADER-BILLING-HWM.md).

## Baseline

All documents in this folder are anchored to **Architecture Baseline v1.2** (2026-06-11). The Implementation Program is **v1.1** (derived from Baseline v1.2). Where a v1 document is referenced (e.g. legacy specs/roadmaps), the v2 / Baseline-v1.2 document supersedes it.
