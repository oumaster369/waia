---
integrationIssue: DEE-711
integrationTitle: "Exact Content-Addressed Market Understanding Attribution"
parentIssue: DEE-622
branch: dee-711-exact-market-understanding-attribution
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, postgres-ci, github-pr-ci]
requiredValidation:
  - focused-contract-and-attribution-tests
  - focused-bridge-isg-and-negative-authority-tests
  - replay-export-and-consumer-closure
  - canonical-pit-and-information-sufficiency-postgres-regression
  - lint
  - typecheck
  - build
  - one-full-frozen-head-suite-with-fresh-sqlite
  - pr-governance
  - independent-exact-head-adversarial-review
approvalGates:
  - human-ratified-dee-622-scope
  - t3-scope-preauthorized
  - integration-ready
  - dee-653-exact-head-admission
includedIssues: [DEE-712, DEE-713, DEE-714, DEE-715]
state:
  status: in-progress
  currentWorkPackage: DEE-712
  completedWorkPackages: []
  remainingWorkPackages: [DEE-712, DEE-713, DEE-714, DEE-715]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 1d8ec175190cb8d72c49ab6337dc848d0099d9f2
  lastValidationAt: "2026-08-24"
  blockedReason: null
  nextAction: "Validate and commit the complete pre-implementation admission manifest, then freeze the shared A contract before file-disjoint B/C work."
provenance:
  createdFrom: human-ratified-delegation
  sourceThread: 01a019c0-8940-7272-bc9c-6b330e6bf0f2
  authoritativeBase: 1d8ec175190cb8d72c49ab6337dc848d0099d9f2
  admissionAudit: "Fresh origin/main, Linear relations/duplicate/ownership, canon and whole-repository producer/consumer/persistence audits passed before writes."
  acceleratedQualityProtocol: "Complete surfaces, invariants, threats and CI-equivalent commands were admitted before implementation; A freezes the shared API, B/C may prepare file-disjoint work, and the integration owner remains sole committer/admitter."
  blindProfileReceiptRatification: "Human-ratified on 2026-08-25: admit exactly backtest-runner.ts and trader-information-inquiry-backtest-parity.test.ts to reject blind PROFILE_RECEIPT before bar reads or cycles; no blind-holdout, production, live, or capital authority."
  fhvLatePauseRatification: "Human-ratified on 2026-08-25: deterministic pause-command ordering and SQLite test-harness isolation only; no holdout data, formula, production/live, or capital semantic change."
---

# DEE-711 — Exact Content-Addressed Market Understanding Attribution

## Admission result

- Authoritative base is `origin/main@1d8ec175190cb8d72c49ab6337dc848d0099d9f2`; the train was canonically re-admitted on that exact clean commit after main advanced, before replaying the already-reviewed implementation tree.
- DEE-622 has no duplicate issue, active owner, branch or PR. Its blockers DEE-597, DEE-598, DEE-620, DEE-621 and DEE-645 are Done.
- The Human-ratified DEE-622 addenda already define the exact claim/evidence boundary, the sufficiency-to-Understanding fail-closed rule, the Reconstruction boundary and removal of actionability. No new scientific, source, security, holdout, retention or capital decision is required.
- DEE-620 admits only `msv_envelope`, `ohlcv_bar`, `quote_l1`, `order_book_snapshot`, `market_trades_snapshot`, `fear_greed_index` and `news_headline` as primitive observations. Its eleven excluded/unmodeled gateway kinds cannot become authoritative evidence in this train.
- No migration is admitted. DEE-620/621 already persist exact PIT/trust/profile/receipt evidence. DEE-623 retains ownership of the durable full causal-cycle bundle and intelligence-record semantic digest.

## Whole-repository surface map frozen before implementation

### Authoritative producers

- `lib/trader/mi/**`: canonical Source, PIT Observation, TrustAsOf and inert Measurement identity/lineage.
- `lib/trader/intelligence/information-sufficiency/**`: `RequiredInformationProfileV2`, authenticated `InformationEvidenceV2`, requirement receipts and runtime authority.
- `lib/trader/intelligence/information-inquiry/**`: exact top-down reconstruction/question identities and bounded inquiry closure.
- `lib/trader/market-data/observation-types.ts` and fusion/replay builders are legacy non-authoritative value carriers only. Their coarse provenance strings cannot be reconstructed into canonical identity.

### DEE-711 producers

- A freezes immutable per-question claims, exact evidence roles, canonical identities, structural question mapping and deterministic derivation/content digests.
- B consumes only a validated DEE-621 `PROFILE_RECEIPT` evidence inventory and the exact normalized-input-to-canonical-receipt binding. Missing authority, research-only declaration, excluded lane, failed PIT/trust or unresolved requirement remains explicitly unavailable/unresolved.
- C pins exact Understanding identities in replay reproduction and M9 exports without changing DEE-623-owned durable cycle persistence.
- D inventories every producer, consumer, persistence seam and forbidden downstream shortcut.

### Consumers and persistence

- Direct consumers include evaluation-cycle, CDE/MSV projections, analytical layers, Hypothesis, market-state, Market Brain, replay reproduction, M9 exports and their tests.
- PostgreSQL remains the unchanged DEE-620/621 source of canonical evidence identity and tenant scope. DEE-622 adds no table, repository or security policy.
- File-based M9 export/replay projections may carry the additive exact Understanding artifact. Historical replay must reproduce the same digest from identical PIT inputs and may not open official blind holdout.
- Forecast, Decision, Risk, Execution, Reality, Guardian, live-capital and production authority are forbidden outputs and direct source consumers.
- The public backtest boundary is admitted only to reject `split: blind` with `PROFILE_RECEIPT` before any bar source or evaluation cycle is reached.

## Invariant and threat checklist

1. Every authoritative evidence reference pins evidence, source, observation id/kind/schema/content digest, TrustAsOf receipt, trust revision id/content digest and optional Measurement ids/digests.
2. Evidence identity is accepted only from an authenticated DEE-621 profile/receipt inventory; fused provenance strings are never upgraded into identity.
3. Question roles remain exact: `SUPPORTING`, `CORROBORATING`, `CONTRADICTING`, `CONTEXTUAL`, `IGNORED` and `MISSING_EXPECTED` (equivalent closed names allowed).
4. `evidenceUsed` is exactly the canonical union of computation dependencies. Available non-dependencies remain explicitly ignored; duplicate evidence and dependence groups cannot inflate use.
5. A question causal-lineage digest excludes ignored evidence, so an unused content revision leaves it unchanged; a consumed observation or trust revision changes it.
6. Claim state is typed. Aggregate confidence cannot erase `PARTIAL`, `UNKNOWN`, `UNAVAILABLE`, `CONFLICTING`, `NOT_REQUIRED` or `NOT_APPLICABLE`.
7. `Q_WHY_HAPPENING` needs authenticated `CAUSAL` evidence. Price/MTF timing, news timing or correlation alone cannot become causal certainty.
8. The structural question mapping is exact: WHAT→WHAT, WHY→WHY, HTF/LTF→CROSS_TIMEFRAME, LIQUIDITY→EXECUTION_LIQUIDITY, HISTORICAL→HISTORICAL; CROSS_VENUE/CROWD/DATA_TRUST/UNKNOWN may summarize only exact matching unknown/contradiction receipt facts or remain unresolved; DEPLOY/PRESERVE are `NOT_APPLICABLE`.
9. `Q_HISTORICAL_ANALOGUES` accepts only development/admissible Pattern/Knowledge evidence. `BLIND_HOLDOUT` evidence is rejected before any reader or resolver is reachable.
10. The eleven DEE-620 excluded/unmodeled kinds are ignored/unavailable, never primitive/canonical/causal. No new Measurement evaluator or formula is introduced.
11. Reconstruction content, per-timeframe evidence dependencies, feature-value identity, profile/receipt identity and derivation-definition identity are pinned explicitly; no unpinned fused aggregate can affect an authoritative claim digest.
12. Identical canonical input ordering produces byte-identical claims and Understanding digest across historical/paper/live-equivalent code paths.
13. Organization, account, symbol, timeframe, PIT, profile and receipt mismatch fails closed before claim construction.
14. Research-only authority without an exact profile/receipt cannot fabricate canonical evidence; it yields no authoritative Understanding claim.
15. Understanding authority is exactly `MARKET_UNDERSTANDING_ONLY`; it cannot produce BUY/SELL, Forecast probability, EV, sizing, permission, order or capital action.
16. Legacy `Q_DEPLOY_CAPITAL` and `Q_PRESERVE_CAPITAL` remain `NOT_APPLICABLE`; no post-processing may overwrite them.
17. Legacy `spotPosture`/aggregate telemetry, if retained for compatibility, has no authoritative actionability and cannot amplify downstream permission.
18. No direct Source/PIT/receipt import is added to Forecast, Decision, Risk, Execution or Guardian.
19. Existing PostgreSQL service-only/RLS/tenant boundaries remain unchanged and are covered by regression proofs.
20. No new migration, provider/source classification, formula, threshold, unit, retention/security policy, credential, production/live path or official holdout access is permitted.
20a. `runBacktest` rejects blind `PROFILE_RECEIPT` before reading bars or running a cycle; it may not strip, reinterpret, or reuse that authority inside blind holdout.
21. Publication is frozen until focused/negative, PostgreSQL, compile/build, one full suite and a fresh zero-P1/P2 exact-head review pass.
22. Rollback is one revert PR of the squash merge; there is no destructive migration or external-state rollback.

## A → (B ∥ C) → D

### DEE-712 — shared contracts

Freeze the closed claim/evidence/absence vocabulary, exact DEE-620/621 identity projection, structural question mapping, canonical ordering, validators, derivation identity and content digests. No evaluator or runtime behavior is introduced.

### DEE-713 — exact bridge/runtime derivation

After A, replace broad provenance and post-hoc set membership with exact computation dependency tracking from the validated receipt. Missing/degraded/contradictory states remain question-relative and excluded lanes fail closed. Remove the capital-question overwrite.

### DEE-714 — replay and export identity

After A and file-disjoint from B, pin exact per-question lineage and Understanding identities in replay-reproduction and M9 export projections. DEE-623 persistence and causal-cycle digest remain untouched.

### DEE-715 — repository closure

Compose B/C, inventory every consumer/bypass/persistence seam, refresh only mechanically affected DEE-620/621/inquiry inventories, and prove tenant/PIT/replay/holdout/no-authority negatives end to end.

## Exact local pre-push checklist

```bash
pnpm test --run tests/unit/trader-market-understanding-evidence-attribution.test.ts tests/unit/trader-market-question-evaluation.test.ts
pnpm test --run tests/unit/trader-market-understanding-bridge.test.ts tests/unit/trader-mi-evaluation-cycle.test.ts tests/unit/trader-mi-understanding-reconstruction.test.ts tests/unit/trader-market-understanding-golden.test.ts
pnpm test --run tests/unit/trader-m9-market-understanding-export.test.ts tests/unit/trader-mi-decision-trace.test.ts tests/unit/trader-m9-provider-fusion-remediation.test.ts tests/unit/trader-replay-fused-context.test.ts
pnpm test --run tests/unit/trader-market-understanding-consumer-closure.test.ts tests/unit/trader-information-sufficiency-consumer-closure.test.ts tests/unit/trader-mi-canonical-source-consumer-closure.test.ts tests/unit/trader-information-inquiry-consumer-closure.test.ts
pnpm test --run tests/unit/trader-market-data-canonical-pit-bridge.test.ts tests/unit/trader-market-data-canonical-pit-replay.test.ts tests/unit/trader-information-need-replay-selection.test.ts tests/unit/trader-research-backtest-isolation.test.ts
pnpm test --run tests/unit/trader-mi-cde-conviction.test.ts tests/unit/trader-market-data-pr25.test.ts tests/unit/trader-market-brain-pipeline.test.ts tests/integration/trader-htx-bar-poll-cycle.test.ts
WAIA_PG_INTEGRATION=1 DATABASE_URL_POSTGRES=<permission-correct-loopback-url> pnpm test --run --no-file-parallelism tests/integration/postgres-information-sufficiency-v2.test.ts tests/integration/postgres-mi-canonical-pit-lineage-v1.test.ts
pnpm exec eslint <all changed TypeScript/JSON-aware admitted paths>
pnpm typecheck
pnpm build
./scripts/linear/validate-integration-train-manifest.sh docs/plans/dee-711-exact-market-understanding-attribution.integration-train.json DEE-711 frozen
pnpm validate:canon
pnpm validate:pr-governance
```

Only after semantic completion and preliminary independent review, run exactly one expensive suite on a fresh migrated SQLite database:

```bash
DATABASE_URL=file:/tmp/dee-711-frozen-head.sqlite pnpm db:migrate
DATABASE_URL=file:/tmp/dee-711-frozen-head.sqlite pnpm test --run
```

Then obtain a fresh independent exact-head adversarial review with zero unresolved P1/P2. Only that exact local-green head may be pushed once, opened as one PR to `main`, admitted by authoritative CI/PostgreSQL and unchanged DEE-653 exact-base/head review, and squash-merged when all gates pass.

## STOP conditions

Stop on a new source/provider class, Measurement/scientific formula or threshold, independent durable Understanding repository, DEE-623 causal-cycle persistence, security/retention change, official blind-holdout access, Forecast/Decision/Risk/Execution/Guardian/live-capital authority, remote semantic overlap, migration collision or unfixable required gate.
