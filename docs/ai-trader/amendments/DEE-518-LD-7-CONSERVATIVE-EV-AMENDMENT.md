# DEE-518 — LD-7 Decision Doctrine Amendment (Conservative EV + DECISION_ACTIONABLE)

> **Status:** Ratified amendment (Gate-D + DEE-518 WP-CANON)  
> **Parent:** [AI-TRADER Decision Doctrine (LD-7)](../AI-TRADER-DECISION-DOCTRINE.md)  
> **Authority:** DEE-516 Human ratification; DEE-518 Human plan approval (2026-08-10)  
> **Implementation plan:** [`docs/plans/dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1.md`](../../plans/dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1.md) §2.4, §1.20–§1.25

## Conservative execution-aware economics (V2)

Per epistemic replica `k` and aleatoric draws `m`:

```
mu_base_k(a)  = mean_m Pi_base(a, x_{k,m})
mu_lower_k(a) = mean_m Pi_lower(a, x_{k,m})
```

Type-7 epistemic quantiles over `{mu_*_k}`:

| Field | Definition |
|-------|------------|
| `EV_base` | Q_0.50(mu_base_k) |
| `EV_lower` | Q_0.10(mu_lower_k) |
| `EV_upper` | Q_0.90(mu_base_k) |

**Invariant:** `EV_lower <= EV_base <= EV_upper` else `EV_RANGE_INVALID → DECISION_NON_ACTIONABLE`.

## DECISION_ACTIONABLE boundary

```
DECISION_ACTIONABLE ⇔ EV_lower > 0
  + upstream data/calibration/scientific-admission gates
```

**Forbidden on V2 capital path:**

- No Risk allowance term in actionability.
- No `StrategySignal.confidence`, `expectedEdge`, or `maxRisk` term.
- No heuristic hypothesis confidence as probability input.

Legacy strategy fields are **quarantined diagnostics** only (plan §1.20).

## Two-contract distinction (B5)

| Contract | Role |
|----------|------|
| `SCIENTIFIC_VALUATION_CONTRACT_V1` | Horizon scoring / counterfactual valuation |
| `FHV_EXECUTABLE_POLICY_V1` | Realized economic path for STAGE-B and blind FHV |

`DECISION_ECONOMIC_PAYOFF_POLICY` MUST align with the executable policy whose equity path STAGE-B measures (plan §1.25).

## Authority chain (frozen)

```
Forecast → Decision → deterministic desired-size → Portfolio → Risk (downward-only) → Execution
```

Decision MUST NOT consult downstream Risk allowance. Risk MUST NOT improve proposals.
