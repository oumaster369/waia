# ADR-0020: M8 Discovery Architecture & No-Reinforcement Boundaries

**Status:** Accepted (M8 implementation)  
**Date:** 2026-07-05  
**Linear:** DEE-383

## Context

M7 delivered observational event attribution memory. M8 adds upstream autonomous **research discovery** — not autonomous trading — under Research Campaign containers with the epistemic pipeline:

`Observation → Research Question → Hypothesis → Experiment → Evidence → Candidate Strategy`

## Decision

1. Implement discovery in `lib/trader/discovery/*` and parametric synthesis in `lib/trader/generator/*`.
2. Wrap — do not fork — the existing RI pipeline via Simulation Broker.
3. Store discovery artifacts in append-only Postgres tables (0074/0075).
4. Enforce [`NO-REINFORCEMENT-LEAKAGE-POLICY.md`](../waia-governance/NO-REINFORCEMENT-LEAKAGE-POLICY.md).
5. Human actuation bridges remain mandatory; promotion FSM unchanged (ADR-0010/0011).

## Consequences

- M6/M7 memory remains descriptive-only for M8 inputs.
- Comparator uses epistemic evidence dimensions only.
- Evolution orchestrator is operator-invoked CLI; default disabled.
- GA/RL/program synthesis remain forbidden as promotion paths.

## References

- M8 plan: `.cursor/plans/m8_strategy_discovery_3fa32d0e.plan.md`
- Strategy Evolution Loop: `docs/ai-trader/AI-TRADER-STRATEGY-EVOLUTION-LOOP.md`
