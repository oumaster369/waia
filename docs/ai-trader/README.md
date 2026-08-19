# AI-TRADER — documentation corpus

Status: Baseline v1.2 (governing) · Date: 2026-06-11

AI-TRADER is a **module of WAIA** (market intelligence + managed trading) reachable at `trader.waia.life`. It attaches to **WAIA Core** for identity, tenancy, entitlements, payments, and audit. This README is the navigation index for the AI-TRADER corpus — it routes, it does not redefine.

> **Authority order:** [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md) wins over any module document. Within AI-TRADER, the [Product Constitution](../AI-TRADER-PRODUCT-CONSTITUTION.md) defines the *finished product* (what AI-TRADER must be); the [Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md) is the governing technical specification; subject-owner docs (Security, Billing & HWM) are authoritative for their subject. Decisions are recorded as [ADRs](../adr/README.md) (AI-TRADER decisions span **ADR-0005 … ADR-0023**).

> **Implementation orientation after the 2026-08-19 Human ratification:** read [AI-TRADER Canonical Algorithm — Autonomous Trader-Researcher V2](AI-TRADER-CANONICAL-ALGORITHM.md) before modifying Trader runtime behavior. It is the Human-ratified Step 0–22 target + Code↔Canon repair contract. It does **not** claim that current `main` already implements the target, and it does not override WAIA Core, the Product Constitution, subject-owner doctrine, or ratified ADR authority.

---

## Reading order

| # | Document | Role |
|---|----------|------|
| 0 | [AI-TRADER Product Constitution](../AI-TRADER-PRODUCT-CONSTITUTION.md) | **Product canon** — what the finished AI-TRADER product is (knowledge-first RI + Market Knowledge + recommend-only operator); not a roadmap or spec. |
| 1 | [AI-TRADER Vision](AI-TRADER-VISION.md) | Purpose, philosophy, long-term direction (no timelines/budgets). |
| 2 | [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md) | Shared platform AI-TRADER depends on (read before the spec). |
| 3 | [AI-TRADER Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md) | **Governing technical specification** (architecture + contracts; no code). |
| 3a | [AI-TRADER Canonical Algorithm — Autonomous Trader-Researcher V2](AI-TRADER-CANONICAL-ALGORITHM.md) | **Human-ratified Step 0–22 implementation orientation and Code↔Canon repair contract** — exact authority boundaries, recurring loops, known legacy gaps, dependency-ordered BUILD and Human stop gates. Current-vs-target truth is explicit. |
| 3b | [AI-TRADER Target Runtime Architecture](AI-TRADER-TARGET-ARCHITECTURE.md) | Target runtime architecture for the completed / mature AI-TRADER: Cloudflare control plane, Execution Server execution plane, Market Canvas, MTF algorithm, Forecast → Decision → Risk → Execution → Reality chain, portfolio/guardian/reconciliation, AI boundary, and completion acceptance signs. Subordinate to Product Constitution and Master Spec; not a roadmap or implementation plan. |
| 4 | [AI-TRADER MVP Scope v2](AI-TRADER-MVP-SCOPE-v2.md) | What is IN / OUT (HTX-only, spot-only, paper-first). |
| 5 | [AI-TRADER Roadmap v2](AI-TRADER-ROADMAP-v2.md) | Governing build sequence (Core uplift first, safety spine pulled forward). |
| 6 | [AI-TRADER Implementation Program](AI-TRADER-IMPLEMENTATION-PROGRAM.md) | **Program v1.2** — execution blueprint (Milestones / Epics / Feature Groups) that drives Linear. |
| 6b | [AI-TRADER Research Intelligence Program](AI-TRADER-RESEARCH-INTELLIGENCE-PROGRAM.md) | **RI Program** — M11 research spine, MKB, operator; Batch H (RI-P7) evidence + Production Knowledge Asset. |
| 6c | [AI-TRADER Strategy Evolution Loop](AI-TRADER-STRATEGY-EVOLUTION-LOOP.md) | **Architectural research canon** — how AI-TRADER evolves strategies from accumulated market knowledge (Research Questions, Programs, Theories, human-broken loop); subordinate to Product Constitution and ADR-0018/0019. |
| 7 | [AI-TRADER Security](AI-TRADER-SECURITY.md) | Binding security model (credentials, key management, kill switches, audit). |
| 8 | [AI-TRADER Billing & HWM](AI-TRADER-BILLING-HWM.md) | Single source of truth for fees / high-water mark. |
| 9 | [AI-TRADER Integration](AI-TRADER-INTEGRATION.md) | Relationships with Core, AI-TWIN, future modules. |
| 10 | [AI-TRADER User Journey v2](AI-TRADER-USER-JOURNEY-v2.md) | End-to-end user flow for the reconciled MVP. |
| 11 | [AI-TRADER Market Intelligence Architecture](AI-TRADER-MARKET-INTELLIGENCE-ARCHITECTURE.md) | **Accepted doctrine** (2026-06-22) — knowledge-first Market Intelligence architecture; peer of the Grandmaster Framework, subordinate + additive to the Master Spec and ADRs. |
| 12 | [AI-TRADER Hypothesis + Evidence Ledger](AI-TRADER-HYPOTHESIS-EVIDENCE-LEDGER.md) | **Ratified doctrine** (LD-5a) — Hypothesis Registry + Evidence Ledger; subordinate + additive to the Market Intelligence Architecture (Knowledge Objects 5–6). |
| 13 | [AI-TRADER Knowledge-to-Action Doctrine](AI-TRADER-KNOWLEDGE-TO-ACTION-DOCTRINE.md) | **Ratified doctrine** (KTA v1.0) — canonical bridge from the Knowledge Spine (LD-5a) to Trading Intelligence (Forecast LD-6, Decision LD-7); subordinate + additive to the Market Intelligence Architecture, peer of LD-5a. |
| 14 | [AI-TRADER Forecast Doctrine](AI-TRADER-FORECAST-DOCTRINE.md) | **Ratified doctrine** (LD-6) — Forecast as the first probabilistic, pre-registered, immutable, scored prediction layer; distribution contract, horizon doctrine, accuracy ≠ profit, economic seam resolved as a Decision sub-evaluation; subordinate + additive to the Knowledge-to-Action Doctrine and the Market Intelligence Architecture. |
| 15 | [AI-TRADER Decision Doctrine](AI-TRADER-DECISION-DOCTRINE.md) | **Ratified doctrine** (LD-7) — Decision as the Risk-bounded, economically-justified posture layer converting an eligible Forecast into intent (incl. do-nothing); Architecture B Economic Sub-Evaluation, Worldview consume-only, Decision Confidence as a bounded ordinal posture; subordinate + additive to the Forecast Doctrine, the Knowledge-to-Action Doctrine, and the Market Intelligence Architecture. |
| 16 | [AI-TRADER Risk Doctrine](AI-TRADER-RISK-DOCTRINE.md) | **Ratified doctrine** (LD-8) — Risk as the deterministic, fail-closed, replayable **enforcement** layer between Decision and Execution; owns the canonical exposure unit, downward-only clamp (size_intent / OQ1), preference-free time-priority allocation arbitration (OQ4), the L0–L6 defense stack, kill-switch hierarchy, and single-use revocable allowances; never predicts, decides, optimizes a portfolio, executes, or raises permission; subordinate + additive to the Decision Doctrine, the Knowledge-to-Action Doctrine, and the Market Intelligence Architecture. |
| 17 | [AI-TRADER Reality Doctrine](AI-TRADER-REALITY-DOCTRINE.md) | **Ratified doctrine** (LD-9) — Reality as the bitemporal, append-only, replayable owner of post-execution **truth** (positions, balances, realized cashflows, settled fills, settlement outcomes, venue/chain events); constructs canonical actual state (dedup + latest-event fold + record + mark) consumed by Risk L6, Decision reassessment, and Billing; owns no policy (finality, trust/custody, attribution, accounting, multi-source aggregation reserved); never decides, enforces, predicts, executes, or observes the market; subordinate + additive to the Risk Doctrine, the Decision Doctrine, the Forecast Doctrine, the Knowledge-to-Action Doctrine, and the Market Intelligence Architecture. |
| 18 | [AI-TRADER Closed Trade Reality Doctrine](AI-TRADER-CLOSED-TRADE-REALITY-DOCTRINE.md) | **Ratified doctrine** (LD-10) — Closed Trade Reality as the billing-truth layer fixing the performance-fee base to **realized, closed-trade profit** (Realized Strategy Profit) and the high-water mark to **cumulative net realized strategy profit**; excludes unrealized mark-to-market from fee assessment; fairness disclosure (realized profit may coexist with unrealized drawdown); consumes LD-9 realized cashflow facts; subordinate + additive to the Reality Doctrine, Billing & HWM, and the Market Intelligence Architecture. |
| — | [AI-TRADER MVP Ratification](AI-TRADER-MVP-RATIFICATION.md) | **Closure seal** (Step 10) — **RATIFIED** 2026-06-29; declarative scope-freeze charter; creates no new rule. Not a spec, ADR, or verification report. |

---

## Authoritative sources

- **Product canon (what the finished module is):** [AI-TRADER Product Constitution](../AI-TRADER-PRODUCT-CONSTITUTION.md).
- **Governing technical spec:** [AI-TRADER Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md) (Baseline v1.2).
- **Human-ratified implementation orientation / repair contract:** [AI-TRADER Canonical Algorithm — Autonomous Trader-Researcher V2](AI-TRADER-CANONICAL-ALGORITHM.md) — Step 0–22 authority graph, recurring-runtime/research loops, current-vs-target ledger, dependency-ordered repair program, and explicit Human gates. Read before Trader runtime changes.
- **Target runtime architecture:** [AI-TRADER Target Runtime Architecture](AI-TRADER-TARGET-ARCHITECTURE.md) — completed-system runtime topology and end-to-end algorithm; subordinate to Product Constitution and Master Spec; additive to ratified doctrines and ADRs.
- **Platform foundation (wins on conflict):** [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md).
- **Execution blueprint:** [AI-TRADER Implementation Program v1.2](AI-TRADER-IMPLEMENTATION-PROGRAM.md).
- **Governing MVP execution (Execution Freeze):** [AI-TRADER MVP Execution Program v2](AI-TRADER-MVP-EXECUTION-PROGRAM-v2.md).
- **Decisions:** [ADR index](../adr/README.md) — AI-TRADER spans **[ADR-0005](../adr/0005-saas-as-superset-strategy.md) … [ADR-0023](../adr/0023-execution-server-ai-trader-only-execution-plane.md)**.
- **MVP closure (Step 10):** [AI-TRADER MVP Ratification](AI-TRADER-MVP-RATIFICATION.md) — scope-freeze charter; **RATIFIED** 2026-06-29; supersedes nothing.
- **Subject owners:** [Security](AI-TRADER-SECURITY.md), [Billing & HWM](AI-TRADER-BILLING-HWM.md), [Closed Trade Reality Doctrine (LD-10)](AI-TRADER-CLOSED-TRADE-REALITY-DOCTRINE.md) (realized fee base).
- **Engineering recovery (active RI-P7 work):** [`replay-runs/RI-P7/AI-TRADER-ENGINEERING-STATUS.md`](../replay-runs/RI-P7/AI-TRADER-ENGINEERING-STATUS.md) — **single canonical entry point** for current phase, resume point, and post-M9 sequence. Do not duplicate elsewhere.
- **Market data operator provisioning (canonical):** [`AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md`](AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md) — **only** source of truth for provisioning every market-data provider from an empty workstation.
- **Market data binding spec:** [`AI-TRADER-DATA-PROVIDERS.md`](AI-TRADER-DATA-PROVIDERS.md) — registry, gateway, degradation policy.
- **Execution Server (off-Cloudflare live plane):** [`EXECUTION-SURFACES.md`](../ops/EXECUTION-SURFACES.md) (`execution-server` surface) · [`EXECUTION-SERVER-RUNBOOK.md`](../ops/EXECUTION-SERVER-RUNBOOK.md) · [ADR-0023](../adr/0023-execution-server-ai-trader-only-execution-plane.md) — AI-TRADER-only; host mutation human-only.
- **FHV systemd deployment record (DEE-435):** [`AI-TRADER-FHV-SYSTEMD-DEPLOYMENT-RECORD.md`](AI-TRADER-FHV-SYSTEMD-DEPLOYMENT-RECORD.md) — `.ops/fhv-systemd-deployed-revision.v1.json`; separate from legacy Docker `deployed-revision.json`.
- **Historical-Test Readiness program (DEE-415):** [`Completion Specification`](../product-specs/ai-trader-historical-test-readiness-completion.md) · [`Gap Registry`](../gaps/ai-trader-historical-test-readiness-gap-registry.md) · [`Roadmap`](../roadmaps/ai-trader-historical-test-readiness-roadmap.md) · [`Canonical integration plan`](../plans/dee-415-ai-trader-historical-test-readiness.md) · [`Post-M9 forensic & status truth-up`](AI-TRADER-POST-M9-FORENSIC-AND-STATUS-TRUTH-UP.md) — Org-0 research-only lane; 23 sequential work packages; one final PR; defines `READY_FOR_FULL_HISTORICAL_TEST` (code-ready Execution Server package, not edge verdict).

## Baseline

All documents in this folder are anchored to **Architecture Baseline v1.2** (2026-06-11). The Implementation Program is **v1.2** (derived from Baseline v1.2; v1.1 plus the LD-6…LD-10 doctrine reconciliation). Where a v1 document is referenced (e.g. legacy specs/roadmaps), the v2 / Baseline-v1.2 document supersedes it.
