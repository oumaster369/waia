---
integrationIssue: DEE-1097
integrationTitle: "Scale-8 historical economics and versioned evidence compatibility"
branch: dee-1097-historical-economics-rounding
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1097
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: implementing
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Verify corrected economics and evidence compatibility; publish one bounded PR."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1097 — historical economics precision

Base audit: main e80f5763fde3a9e45aa49c7af75231699601c0f6; finding D-02, package P03. This is a correction to the declared scale-8 HALF_UP implementation, not a cost-policy change. At price100 and quantity1, existing D-5 rates imply BUY net price100.15/cash-100.35. The previous helper rounded per-unit adjustments to half-unit steps and returned100/-100.2. All16 new independent known answers failed before the correction;19 existing tests passed.

## Acceptance

Use signed integer HALF_UP division directly into scale-8 units. Independent Python Decimal answers cover BUY/SELL, price100/3400.01/64001.23, rounding below/at/above a half-ulp tie and fractional quantities. Cover split fills, same-price round trip and component/cash rounding bounds. Do not convert money to Number.

Keep the D-5 policy/model schema/rates unchanged. New economics identifies simulator implementation1.0.1, included in the existing content digest. Preserve old rows/digests unchanged. New execution checkpoints include simulatorVersion; legacy/mismatched checkpoints remain readable as historical evidence but fail closed before restoring mutable simulator state. This avoids silently mixing1.0.0 and1.0.1 in a resumed economic replay. Model schema mismatch also refuses restoration. Successful same-version resume remains deterministic.

Tests cover historical fill economics, simulator/checkpoint/production adapters, atomic cycle/resume, cost-vector/Guardian causal consumers, chronological replay and closed-trade billing. Run actual PostgreSQL atomic-cycle tests, lint/typecheck/build, both consumer graphs, canon and PR governance, then required exact-head PR CI. No UI changes; no real exchange calls.

## Evidence impact and required disposition

| Consumer/evidence | Proven dependency | Disposition |
|---|---|---|
| `execution/execution-service.ts`; `historical-simulation-v2/production-transaction-adapters-v2.ts`; `modeled-execution-advance-v2.ts` | Calls `applyHistoricalExecutionEconomics` for modeled fills | Fresh replay/qualification uses corrected implementation and new run/release identity. Do not append corrected fills into an old arithmetic run. |
| `backtest/backtest-runner.ts`; `backtest/htr-wp22-multi-position-correctness.ts` | Calls corrected function | Regenerate economic acceptance evidence on the chosen new tuple; retain prior evidence as superseded, not overwritten. |
| `observability/control-replay-chronological-v2-driver-v1.ts` | Entry and flatten fills call corrected function | Final economic Control Replay receipts must be generated with the corrected release. Prior success is not reusable economic acceptance. |
| `research/wp21-g2-cost-vector-comparison.ts` | Computes cost-vector fills with corrected function | Rerun software regression; future selected-package economic qualification uses corrected implementation. |
| Order/fill repositories; `historical-simulation-v2/atomic-cycle-repository-postgres-v2.ts` | Validate stored economics/digests, not recompute saved amounts | Stored historical economics remains immutable and readable; no data migration. New simulator version differentiates digest identities. |
| Execution checkpoint/replay resume | Resumes partial order fills | Reject missing/old arithmetic version before state replacement. Inspect/replay old evidence with its pinned original code; corrected runs require fresh qualified identity. |
| Accounting/operational PnL/billing inputs derived from modeled fills | Indirect numerical dependency | Recompute future qualification results from new modeled evidence. Never recalculate issued invoices, modify HWM or promote modeled values to live truth. |
| Active C3 missing-only forecast producer | Literal import closure of `scripts/trader/missing-only-forecast-producer-cli-v1.ts`:25 files, zero changed economics/checkpoint files, zero unresolved local literal imports on this baseline | Do not invalidate, restart or rewrite predictive C3 for this arithmetic patch. Running producer remains pinned to680c9d7c read-only mount. Still verify final predictive seals and exact tuple compatibility before reuse; forecast completeness alone does not qualify economic replay. |

The audit's broader source import graph has429 reverse-reachable files, including type imports. That is a review inventory, not proof that429 economic outputs are wrong. No exhaustive production receipt list has been read or regenerated by this software patch. The final qualification packages must enumerate concrete prior/new run receipts and accept or reject each for its exact implementation identity. No scientific PASS is inferred here.

## Authority and rollout

User explicitly delegates technical implementation, self-review, PR merge after required checks and non-trading deployment. Self-review is not an independent/Human attestation. No change to service fee30%, HWM, settlement, finality, live permission, safety/scientific thresholds or holdout firewall. C3 workers, image/mount, state, code and parameters remain untouched. No old evidence deletion or migration and no activation of trading.

Review checkpoint incompatibility before any historical executor rollout: pinned old runs keep their pinned code; new corrected evidence uses new run/release identity. Rollback is a reviewed source/release revert, not mutation of saved economics. Do not relax version checks to resume an incompatible checkpoint. Integrate serially after DEE-1096 and revalidate source inventory against the exact combined main.

## Integration validation

Rebased onto main a4c2f777 after PR#660 passed all31 checks and merged. Local final consumer regression80 tests/6files PASS, resume regression66/5files PASS (overlapping suites), actual PostgreSQL atomic-cycle12 PASS. Lint0errors/324 pre-existing warnings, typecheck/build/canon/governance PASS. On the combined tree,62 targeted tests/3files and both consumer graphs PASS. Reality inventory source-content seal refreshed for the sole reviewed source member historical-simulated-exchange.ts;155sources/134consumers/25connector references and path identities unchanged. Authoritative full exact-head CI remains a PR gate.

## Full CI follow-up

PR #661 first exact-head full unit shard found one additional indirect fixture in `historical-current-modeled-guardian-v2.test.ts` that encoded the previous arithmetic (cash726.94/loss273.06). Independently checked unchanged D-5 rates: buy9 at gross100 costs903.15, sell9 at gross70 returns627.795; final cash724.645/loss275.355, drawdown2753bps after existing accounting truncation. Update this oracle with the calculation beside it; retain all Guardian STOP_ACCOUNT/Risk veto/no-submission and threshold assertions. This is not a new Guardian threshold or policy. Rerun the affected Guardian/accounting/economics regressions and require fresh full CI at the new head.
