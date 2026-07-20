# M7 → M8 Boundary (Anti-Reinforcement Layer)

**Authority:** DEE-382 / M7 implementation  
**Status:** Binding for M8+ design reviews

## M7 outputs are observational only

Events, classifications, attributions, confidence snapshots, explanations, and edges are **descriptive correlations** — not causal claims, not tradeability signals, not reward labels.

## M8 consumption rule

**M7 tables/edges must NOT be read by M8 as reward labels, training targets, fitness scores, or optimization inputs.**

M8 may read M7 **only** as descriptive context for human-reviewed hypothesis generation.

## Confidence semantics

Historical attribution consistency only — **not** P(profit) or execution confidence.

## Closed loop prohibition

No autonomous loop from M7 artifacts to strategy generation or execution without explicit human gate + future ADR.
