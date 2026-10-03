---
kind: plan-amendment
---

# DEE-1159 development stage binding

This amendment follows the sealed modeled-stage kernel. It does not change that kernel's public call: an owned executor, a descriptor minted by `sealOwnedResearchModeledStageDescriptorV1`, and an already verified payload. `scientificQualified` and `capitalEligible` stay false. Blind replay, scientific qualification, live orders, and migrations 0229 and 0230 stay out of this slice.

`runBoundDevelopmentModeledStagesV1` is the DEVELOPMENT dispatch for train, validation, and walk-forward. It refuses a forged callback, a parameter, evaluator, cost, or universe mismatch, a registration that was not sealed before scoring, and a repeated validation selection. It then calls only the sealed kernel and writes runner-observed receipts through the same executor. The receipt table statement is not a journal migration and is not applied here.

`runWalkForwardValidation` no longer scores a caller-supplied backtest. The legacy research pipeline still fits a lookback scorer, runs validation by strategy id, and records `evidenceBacktestUsesTrainFit: false`. That path remains ineligible and is not switched in this slice, because it also carries the blind tail and does not have a registered stage payload.

DEE-1159 and parent DEE-1152 stay open.
