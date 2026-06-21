# ADR-0010 — Strategy Validation Gate (paper → live)

Status: Accepted
Date: 2026-06-11
Baseline: v1.2

## Context

The Red Team review correctly identified that a flawless trading platform with no strategy edge still fails, and that the Baseline contained a contradiction: the Master Spec required that no strategy go live without validation, while the roadmap deferred Research automation to post-MVP yet enabled Org-0 live trading. A 48-hour paper-stability check proves the *plumbing* works; it does not prove an *edge* exists. Promoting a strategy to live capital on plumbing-only evidence is unsafe.

This ADR introduces a governance gate — not quantitative thresholds — between Paper Trading and Org-0 Live Trading. It resolves the validation contradiction by making the authorization criteria explicit and manual.

## Decision

A **Strategy Validation Gate** sits between Paper Trading (Roadmap Phase 7) and Org-0 Live Trading (Roadmap Phase 8). No strategy may be promoted to live capital — even for Org 0 — until it passes this gate. The gate defines governance structure only; quantitative thresholds are set later by the operator and recorded.

1. **Minimum validation evidence.** A promotion record must exist containing: the strategy version and git commit, the documented hypothesis and intended regime, the paper-trading evidence (see below), the cost model (fees + slippage assumptions), the observed reason-code/decision distribution, and the known failure modes.
2. **Paper-trading evidence requirements.** Paper evidence must cover a window long enough to be meaningful for the strategy's horizon (not merely the 48-hour plumbing-stability check), across more than one market regime where observable, with reconciliation clean throughout and data-quality acceptable.
3. **Acceptable confidence criteria.** The operator must record an explicit, written judgment that the strategy's paper evidence shows edge net of modeled costs, that live behavior is expected to track paper behavior, and that the downside is bounded by the Risk Engine. Absence of evidence is treated as failure, not as neutral.
4. **Governance approval.** Promotion is an explicit, logged administrative action under the Single Operator Governance Model (ADR-0011): immutable audit entry, cooling-off period before the promotion takes effect, and explicit confirmation. Promotion is reversible (demotion to paper) at any time.

The 48-hour paper-stability exit in the roadmap remains a *plumbing* gate; it is necessary but **not sufficient** for live promotion. This Validation Gate is the sufficiency condition.

## Consequences

+ Resolves the live-before-validation contradiction; the Master Spec validation rule and the roadmap now agree.
+ Prevents capital exposure on unproven edge — the single most likely product failure.
+ Keeps validation manual and MVP-appropriate; no Research automation is required for MVP.
− Adds a deliberate hold between paper and live; this is intended friction.
Neutral: introduces no quantitative thresholds and no new product scope.

## Links

- [AI-TRADER Roadmap v2](../ai-trader/AI-TRADER-ROADMAP-v2.md)
- [AI-TRADER Master Spec v2](../ai-trader/AI-TRADER-MASTER-SPEC-v2.md)
- [DEE-170 — M7 Milestone Hygiene & Governance Review](../ops/DEE-170-M7-MILESTONE-HYGIENE-GOVERNANCE-REVIEW.md) — M7.5 Linear milestone hygiene and operator execution plan
- [ADR-0011 Single Operator Governance Model](0011-single-operator-governance-model.md)
- [ADR-0009 Regulatory posture](0009-regulatory-posture.md)
