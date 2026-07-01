# ADR-0019 — AI Operator Intelligence Authority Boundaries

Status: Accepted  
Date: 2026-07-01

## Context

The AI Operator concept proposes that AI orchestrates the research/validation process (hypotheses, backtests, evidence assembly) while execution, risk, and promotion remain deterministic. Without explicit authority boundaries, an operator loop risks goal drift, self-promotion, or silent mutation of sealed evidence.

## Decision

The **AI Operator Intelligence** subsystem (RI-P5) is **recommend-only**. It may:

- Read market state, KB/MI registers, backtest results, and promotion-record drafts.
- Propose hypotheses and strategy candidates (written to MI registers).
- Trigger deterministic research jobs (backtest, walk-forward) via whitelisted, audited actions.
- Draft gate packages for human review.
- Persist operator memory and action audit logs.
- Use `CompletionProviderPort` via `lib/ai-gateway` with `WAIA_AI_*` env namespace; `FakeCompletionProvider` in CI (fail-closed default).

The AI Operator **must never**:

- Promote strategies or mutate promotion FSM state.
- Live-enable trading or place orders.
- Move funds or mutate balances.
- Mutate risk limits, kill-switch, or thresholds.
- Mutate sealed datasets, digests, or blind-validation locks.
- Open blind validation outside deterministic RI-P3 machinery.
- Score its own evidence or bypass human/operator attestation.

**Authority ladder:** Intelligence recommends → deterministic evaluators compute → human operator attests → deterministic gate assembles → FSM transitions under ADR-0011.

All operator actions are append-only audited. Provider failures fail closed (no recommendation on error).

## Consequences

+ Safe process orchestration without capital authority.
+ Aligns with MI Architecture §3 and DEE-80 prompt envelope doctrine.
− Requires authority-boundary tests in every operator PR.
− Scope explicitly excludes ecosystem-wide COO (billing/security/releases).

## Links

- [ADR-0010 Strategy Validation Gate](0010-strategy-validation-gate.md)
- [ADR-0011 Single Operator Governance Model](0011-single-operator-governance-model.md)
- [DEE-80 Prompt Envelope Doctrine](../architecture/DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md)
- [AI-TRADER Research Intelligence Program](../ai-trader/AI-TRADER-RESEARCH-INTELLIGENCE-PROGRAM.md)
