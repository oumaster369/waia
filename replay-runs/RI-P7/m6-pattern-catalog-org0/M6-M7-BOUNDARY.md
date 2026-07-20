# M6 → M7 Transition Boundary (Anti-Reinforcement Layer)

**Authority:** Post-merge governance (DEE-381 / PR #368)  
**Status:** Binding for M7+ design reviews

## M6 outputs are observational only

Pattern scores, confidence snapshots, price-move explanations, and knowledge edges (`pattern_associated_with_close`, `pattern_associated_with_rejection`) are **descriptive correlations** — not causal claims, not tradeability signals, not edge.

They MUST NOT be used as:

- reward signals
- training targets
- strategy optimization inputs
- inputs to Guardian, Risk Engine, order submit, sizing, or promotion automation

## Confidence semantics

M6 confidence is a **historical consistency metric** (Beta-style posterior over supporting/contradicting/neutral outcome tags).

It is **NOT** a probability of profit or success.

## M7 and future milestones

Any future system (including M7 event attribution memory) MUST NOT:

- use M6 edges as optimization reward
- feed pattern scores into decision engines
- treat confidence as P(success)
- close an autonomous loop from M6 artifacts to execution without explicit human gate

M7 may **read** M6 artifacts for human review and recommend-only workflows only.

## Execution isolation (verified at merge)

M6 is READ → ANALYZE → STORE only. Default-off research hook; no production wiring at merge. No feedback into M3/M4/M5, paper-cycle decisions, or backtest metric semantics.
