---
integrationIssue: DEE-1183
integrationTitle: "AI-TRADER: fence blind payload access and commit research outcomes atomically"
branch: dee-1183-blind-payload-atomic-outcome
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, isolated-postgres, github-pr-ci]
requiredValidation: [lint, typecheck, build, targeted-unit, native-postgres, validate-canon, consumer-graph, independent-review, required-ci]
approvalGates: [root-review-before-commit, independent-review, required-ci, no-real-holdout]
state:
  status: in-progress
  currentWorkPackage: WP-4
  completedWorkPackages: [reviewed-scope, canonical-plan, source-extraction, focused-regressions, exact-native-proof, static-validation, rebase-current-main, exact-rebased-local-readiness, root-final-review]
  remainingWorkPackages: [required-ci]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 8acb1cb3bed2f42ad4e7c6b8986ff141c65f51ac
  lastValidationAt: "2026-10-01T19:10:54Z"
  blockedReason: null
  nextAction: "Publish the reviewed patch and wait for all required and applicable current-head PR CI."
provenance:
  createdFrom: "DEE-1183 plus focused independent source audit on 2026-10-01"
  gapRegistry: null
  supersedes: null
---

# DEE-1183 — blind payload boundary and atomic research outcomes

## Context and goal

The prepared DEE-1159 branch exposed blind payload rows before the separately durable DEE-540 one-shot consumption, and split successful backtest effects from success-result persistence across savepoints. A failure while inserting the successful result could therefore leave mock order/lifecycle writes committed with a terminal failure record. Concurrent outcomes could also restore a shared parent-pool guard before every active outcome had finished.

This child extracts only the reviewed ingress and lifecycle boundary correction so it can integrate independently of the larger same-executable research runner. It preserves the existing DEE-540 authorization meaning and uses synthetic fixtures for verification.

## Scope

- Campaign CLIs and callers perform metadata-only preview before disclosure. Dataset counts/digests can be checked before content access; ordinary non-blind reads are restricted to the sealed, declared half-open range.
- Blind OHLCV is loaded only through an active, single-use payload capability after DEE-540 consumption has independently committed. Failure and reconstruction paths use the same boundary; no generic market-bar loader becomes a blind-data path.
- Lifecycle and persistence ports used by a blind outcome are bound to the actual outcome executor.
- Backtest effects and successful result persistence share one driver-managed savepoint. On result failure that child rolls back, then the parent records terminal failure while retaining the independent consumption burn.
- A reference-counted parent guard remains active until all overlapping outcomes exit, then restores the original parent methods exactly once.
- Refresh the Reality v2 consumer inventory and validator pins for this exact extraction.

The result remains a bounded technical correction. Passing these checks does not qualify a strategy, grant blind/C3 access, or prove scientific readiness.

## Do not

Do not add research registry/attempt/training-reader work, lookback kernels, scoped mock-ledger foundations, migrations, or new strategy-qualification logic. Do not change financial policy, root-transaction guards, DEE-540 authorization semantics, or reuse/relax existing scientific gates. Do not access real holdout or C3 payloads, call a venue, place live orders, or imply production readiness.

## Files

Production scope:

- `lib/trader/market-data/market-bars-repository-postgres.ts`
- `lib/trader/research/blind-holdout-engine.ts`
- `lib/trader/research/dee-540-blind-tail-commit.ts`
- `lib/trader/research/m9-dataset-seal-preview.ts`
- `lib/trader/research/reconstruct-research-failure-artifacts.ts`
- `lib/trader/research/research-orchestrator.ts`
- `scripts/trader/m9-v2-research-campaign.ts`
- `scripts/trader/research-pipeline-cli.ts`
- `scripts/trader/ri-evidence-campaign.ts`

Focused tests and graph evidence:

- `tests/integration/postgres-research-blind-ingress-v1.test.ts`
- `tests/integration/postgres-dee540-blind-tail-max-pool.test.ts`
- `tests/integration/postgres-research-intelligence-parity.test.ts`
- `tests/unit/trader-dee540-blind-tail-commit.test.ts`
- `tests/unit/trader-dee540-blind-tail-gate.test.ts`
- `tests/unit/trader-reality-v2-consumer-graph.test.ts`
- `scripts/trader/validate-reality-v2-consumer-graph.ts`
- `docs/ai-trader/reality-v2-source-consumer-inventory.json`
- This plan.

No schema or migration files are in scope. The source was extracted from the reviewed DEE-1159 snapshot at `dfeb61244466d9e762f5c5c97b5ec07ff82b61ff`, then rebased from `2589bb3a` onto the current `origin/main` commit `42810ef804150dab0b1f9c01cb38b5bd8bac3659`. Only the files listed above were brought across; the prepared branch's registries, training reader, research kernels, and scoped ledger stay out. All 13 functional/test files are byte-identical between the pre-rebase commit `ecc710f7` and current head `8acb1cb3`; the inventory diff includes the merged DEE-1161 main changes and this child’s four content pins.

## Work packages

1. Extract the reviewed production correction and its focused tests onto the current `origin/main` base. Preserve compatibility with the already merged DEE-1160 root-transaction boundary.
2. Regenerate the consumer inventory/pins and run the three native lifecycle/ingress suites on an isolated synthetic PostgreSQL instance. Prove metadata-before-payload, committed burn before read, one-shot refusal, rollback of real mock-order/lifecycle writes on result-insert failure, and guard lifetime under overlap.
3. Run focused units, lint, typecheck, build, canonical validation, and the consumer-graph verifier; bind the result to exact source hashes.
4. Obtain root and independent review before commit/publication, then wait for required current-head PR CI.

## Acceptance

- Native synthetic regressions prove all OHLCV transfers occur only after the separately committed DEE-540 burn and through the single-use capability; non-blind reads remain half-open and do not load blind rows.
- A second opener is refused. Burn survives read/backtest/result failures. A forced success-result SQL failure rolls back actual mock order and lifecycle writes, while a terminal failure record persists outside that rollback with the expected phase.
- The overlapping-outcome unit regression proves the parent guard remains active until the last outcome exits and original methods are restored afterward.
- All campaign, preview, and failure-reconstruction call sites preserve the metadata/content boundary, and the refreshed consumer graph validates on this branch.
- Focused tests, lint, typecheck, build, `pnpm validate:canon`, consumer graph, independent review, and required PR CI pass on the extracted source. The exact-base/source receipt is retained; the broader 69-test DEE-1159 combined proof is supporting evidence only and is not child-branch acceptance.
- No real holdout/C3 data, exchange requests, production database, live order, migration, or scientific qualification is used or claimed.

## Validation

On 2026-10-01, the pre-rebase child branch passed 52 focused unit tests, the three native synthetic PostgreSQL suites (29 passed, 0 failed, 0 skipped) on the pre-rebase source, lint, typecheck, build, canonical validation, and consumer-graph validation. After rebasing onto `42810ef8`, all 13 native-covered functional/test files remained byte-identical; rebased focused checks passed again (53 units, lint, typecheck, build, canon, graph). Exact native source hashes and execution receipts are retained in the external Oct01 audit folder under `dee1183-blind-boundary-native`; rebased source-equivalence and command receipts are under `dee1183-rebased-*`. Root re-reviewed the rebased functional diff and exact native source equivalence with no new actionable finding. Only this plan changed after the rebased validation; the final commit binding records the unchanged functional files. Required PR CI has not run yet.

Expected local checks:

```bash
pnpm exec vitest run tests/unit/trader-dee540-blind-tail-commit.test.ts tests/unit/trader-dee540-blind-tail-gate.test.ts tests/unit/trader-reality-v2-consumer-graph.test.ts
pnpm exec vitest run tests/integration/postgres-dee540-blind-tail-max-pool.test.ts tests/integration/postgres-research-intelligence-parity.test.ts tests/integration/postgres-research-blind-ingress-v1.test.ts
pnpm lint
pnpm typecheck
pnpm build
pnpm validate:canon
pnpm validate:reality-v2-consumer-graph
```

Native tests must use the repository's isolated loopback PostgreSQL fixture with synthetic content only. Do not run a full unit suite locally; GitHub PR CI is authoritative.
