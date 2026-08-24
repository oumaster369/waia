---
integrationIssue: DEE-695
integrationTitle: "Top-Down Inquiry + Deterministic Information Need Planner Integration Batch"
parentIssue: DEE-645
branch: dee-695-top-down-information-inquiry
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, postgres-ci, github-pr-ci]
requiredValidation:
  - focused-contract-and-known-answer-tests
  - focused-gateway-and-replay-negative-tests
  - information-sufficiency-postgres-regression
  - whole-repository-consumer-and-reality-inventory-closure
  - lint
  - typecheck
  - build
  - one-full-frozen-head-suite-with-fresh-sqlite
  - pr-governance
  - independent-exact-head-adversarial-review
approvalGates:
  - human-ratified-dee-645-scope
  - t3-scope-preauthorized
  - integration-ready
  - dee-653-exact-head-admission
includedIssues: [DEE-696, DEE-697, DEE-698, DEE-699]
state:
  status: in-progress
  currentWorkPackage: integration-validation
  completedWorkPackages: [DEE-696, DEE-697, DEE-698, DEE-699]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 258203149654f8d1490b2e35d9fcc988f7c30de7
  lastValidationAt: "2026-08-24"
  blockedReason: null
  nextAction: "Validate and commit the frozen manifest, run the one fresh-SQLite full suite, obtain final exact-head review, then publish the single PR for CI and DEE-653 admission."
provenance:
  createdFrom: human-ratified-delegation
  sourceThread: 01a019c0-8940-7272-bc9c-6b330e6bf0f2
  authoritativeBase: c7b897db85e560f7f2b98a48da4c0f520636d690
  admissionAudit: "Fresh origin/main reconciliation, Linear duplicate/ownership/dependency audit, canonical-algorithm audit, and repository producer/consumer scan passed before writes."
  acceleratedQualityProtocol: "Human-directed complete up-front surface/threat/command admission; A API freeze first; file-disjoint preparation may parallelize only without weakening serialized admission, sole-committer ownership, or exact-head review."
---

# DEE-695 — Top-Down Inquiry + Deterministic Information Need Planner

## Admission result

- Authoritative base: `origin/main@c7b897db85e560f7f2b98a48da4c0f520636d690`.
- Unique owner: DEE-645; no duplicate active issue, batch, branch, or child existed at admission.
- Formal blockers DEE-620, DEE-621, and DEE-628 are Done. DEE-645 blocks DEE-622.
- DEE-629 and DEE-636 remain separate downstream/intelligence and Guardian authorities. This train exposes typed gaps and scheduling inputs only; it does not implement their state, hypothesis, position, economic, or protective-action semantics.
- The Human-ratified DEE-621 profile already supplies allowed primitive kinds, provider satisfiers, substitutions, PIT/replay requirements, freshness, trust, contradiction policy, and depth/time/fan-out bounds. DEE-645 consumes them and selects no new provider/source class, formula, threshold, relevance window, fairness weight, or empirical policy.
- No migration is admitted. Plans, attempts, selections, and termination receipts are immutable/content-addressed runtime lineage; DEE-623 owns later cycle-bundle pinning. PostgreSQL validation is a regression proof for the unchanged DEE-620/621 persistence boundary.

## Whole-repository surface map frozen before implementation

### Producers and authority inputs

- DEE-621 profile/receipt/runtime authority: `lib/trader/intelligence/information-sufficiency/**`.
- Canonical primitive observations and PIT lineage: `lib/trader/mi/**` and the narrow market-data normalization/replay bridge already delivered by DEE-620.
- Mandatory market state and optional provider observations: `lib/trader/market-data/market-data-gateway.ts`, provider registry, adapters, HTX poll source, and replay historical ingress.
- Existing questions and knowledge gaps: `lib/trader/intelligence/market-understanding.types.ts` and `market-understanding-bridge-v0.ts`.

### New DEE-645 producers

- `lib/trader/intelligence/information-inquiry/contracts-v1.ts`: closed vocabulary, immutable identities, deterministic canonicalization, typed authority exclusions.
- `lib/trader/intelligence/information-inquiry/top-down-reconstruction-v1.ts`: exact `1d → 4h → 1h → 15m → 1m` roles/relations without scientific direction invention.
- `lib/trader/intelligence/information-inquiry/historical-analogue-contract-v1.ts`: policy-bound Pattern occurrence/match/Knowledge result identities and exact no-result/unavailable distinctions, without mining or Knowledge authority.
- `lib/trader/intelligence/information-inquiry/information-need-planner-v1.ts`: profile-driven needs, selected/ignored sources, relevance/freshness/bounds and causal digest.
- `lib/trader/intelligence/information-inquiry/information-inquiry-loop-v1.ts`: bounded attempts, explicit unavailable/rejected/unresolved terminals and final DEE-621 evaluation seam.
- `lib/trader/intelligence/information-inquiry/inquiry-scheduler-v1.ts`: deterministic open-position priority plus bounded new-opportunity progress, with no position action semantics.
- `lib/trader/intelligence/information-inquiry/information-inquiry-runtime-v1.ts`: mandatory-first production composition seam joining the planner to live/replay selective acquisition and refresh/re-evaluation through an exact per-cycle authority/policy resolver.
- `lib/trader/market-data/replay/information-need-replay-selection-v1.ts`: as-of/PIT filtering over already-supplied replay evidence; it cannot import or invoke live providers.

### Direct consumers and ingress seams

- `MarketDataGateway.pollEvaluationBundle`, the two-phase `HtxBarPollSource` API, `capture-provider-snapshot`, and the provider registry/adapters.
- Historical ingress and WP11 replay parity/absence/research-isolation proofs.
- `runPollPaperCycles`, `runPaperBarCloseLoop`, `runPaperLoopCycle`, canonical `runBacktest`, their typed inputs/dependencies and worker construction are the standard composition callers. An injected `InformationInquiryCycleAuthorityResolverV1` must return the exact profile/receipt/policy for the current organization/account/symbol/purpose/PIT after mandatory acquisition; omission or mismatch requests no optional providers and DEE-621 remains fail-closed. Historical `runBacktest` resolves each cycle independently with the same plan semantics over PIT inputs and cannot call live providers.
- Market Understanding receives reconstruction/question lineage only. Forecast, Decision, Risk, Execution, Reality, Guardian, live-capital and all non-admitted production modules are forbidden consumers in this train.

### Tests and governance surfaces admitted up front

- New contract, reconstruction, planner, loop, scheduler, gateway, replay, runtime and consumer-closure tests listed in the manifest.
- Existing gateway, HTX poll, WP11 replay, Market Understanding, DEE-620 canonical source/consumer, DEE-621 consumer/runtime, paper poll, Reality source/consumer and research-isolation tests listed in the manifest may be mechanically updated only where the ratified behavior changes an expectation.
- `docs/ai-trader/reality-v2-source-consumer-inventory.json` is admitted because new files under `lib/trader/market-data/**` mechanically change its exact count/content digest while all Reality dispositions remain unchanged.
- The plan and manifest are the only governance files. Package scripts may change only if an exact CI-equivalent command cannot otherwise be expressed; no package change is presently expected.

## Explicit invariant and threat checklist

1. **Profile authority:** every requested optional provider is an exact satisfier in the bound DEE-621 profile; connected-but-unlisted providers are ignored.
2. **Primitive-kind boundary:** only DEE-620 canonical primitive kinds may satisfy a need. A registered provider is callable only when its registry kinds intersect the need's allowed canonical primitive kinds; unknown or kind-mismatched providers produce typed `REJECTED` without a call or throw. Excluded/unmodeled gateway kinds never become primitive evidence.
3. **Hard-floor monotonicity:** optional quantity, aggregate scores, or substitutions cannot compensate for a failed mandatory/context-triggered hard minimum.
4. **No caller forgery:** provider selection is derived from a validated plan/profile identity, not a free string list that can widen authority.
5. **No default eager polling:** absent an exact selection, optional providers are not called. Mandatory execution-venue state remains explicit and unchanged.
6. **Causal digest isolation:** available-but-unrequested and irrelevant provider data cannot alter plan, selection, or evidence causal digests.
7. **Truthful availability:** unavailable/rejected/stale evidence remains typed; no zero, stale, current-latest, cached, interpolated, or synthetic fallback.
8. **PIT/replay parity:** historical mode consumes only already-supplied evidence knowable at the anchor and cannot import/call live gateway, fetch, or provider clients.
9. **No future/holdout leakage:** future timestamps, source-latest values, and official blind-holdout lanes are rejected or unreachable.
10. **Top-down authority:** reasoning order is exactly 1d→4h→1h→15m→1m; 1m cannot overwrite a higher-timeframe state. Bottom-up anomalies may request bounded re-evaluation only.
11. **Typed contradiction:** valid conflicting observations retain both exact identities, source/dependence groups, affected question/claim, policy-supplied materiality and reason codes; policy may request discriminating evidence or terminate unresolved, never silently choose a winner.
12. **Causal WHY:** price/MTF state alone cannot answer causal WHY. A qualified causal need or explicit unresolved state is required.
13. **Boundedness:** depth, duration, provider fan-out, query count, result count and abstract acquisition-cost-unit budget are mandatory deterministic versioned-policy inputs with no defaults or values selected here. The same policy pins exact non-negative cost-unit assignments by need/provider (or an exact evaluator version/digest plus caller-supplied evaluated units), so every attempt decrements the budget reproducibly. Missing attribution is rejected; exhaustion terminates `UNRESOLVED/INFORMATION_INSUFFICIENT`; no recursion or busy-loop.
14. **Analogue safety:** historical analogue requests pin caller-supplied state-representation version/digest, current dynamic-state digest, requested `STATIC | TRAJECTORY | MULTISCALE_TRANSITION` Pattern forms, similarity-policy version/digest, timeframe/regime/context filters and bounded query/result/cost budgets. Results preserve exact Pattern Definition/Occurrence refs, match/distance components, applicable Knowledge refs and preregistered positive/negative/flat/contradictory/unresolved/failure sampling membership. Terminals distinguish `NO_MATCHING_OCCURRENCE`, `NO_QUALIFIED_RELATION_KNOWLEDGE`, `QUALIFIED_KNOWLEDGE_STALE_CONTESTED_OR_OUT_OF_SCOPE`, and `HISTORY_UNAVAILABLE_OR_UNQUALIFIED`; no future PnL, blind holdout, unbounded scan, or synthesized Knowledge conclusion.
15. **Hypothesis boundary:** competing-hypothesis discriminator inputs pin exact assessment/hypothesis/failure-boundary identities and may request only missing discriminating evidence. `NO_APPLICABLE_QUALIFIED_HYPOTHESIS` routes a typed research question to DEE-646. The planner cannot create, rank, mutate or select an executable Hypothesis, lifecycle/confidence, probability or action.
16. **Capital boundary:** source selection and sufficiency are epistemic only; no BUY/SELL, probability, EV, sizing, Risk permission, Execution call, Guardian action, live, or capital authority.
17. **Scheduling fairness:** open-position reassessment is first under contention, while a deterministic finite bound guarantees new-opportunity progress; no economic/position decision is made.
18. **Identity determinism:** identical organization/account/symbol/PIT/profile/evidence/policy input produces byte-identical canonical plan and selection digests independent of input ordering.
19. **Tenant/scope binding:** organization, account, symbol, venue, purpose, timeframe and PIT must match the bound profile/receipt; mismatch fails closed.
20. **Separation:** DEE-620 observation lineage and DEE-621 sufficiency semantics are consumed unchanged; DEE-622/623/629/636/642 authority is not preempted.
21. **Reality boundary:** refreshed Reality inventory changes counts/digests only; all Reality dispositions, admitted source kinds and fail-uncertain exclusions remain byte-for-byte semantic equivalents.
22. **Publication freeze:** no PR push/update until focused, negative, compile, build, PostgreSQL regression, inventory, governance, and exact-head zero-P1/P2 review pass locally.
23. **Purpose mapping:** DEE-645 `NEW_OPPORTUNITY_SEARCH` maps exactly to DEE-621 `NEW_OPPORTUNITY`, `RESEARCH` maps exactly to `RESEARCH_NON_CAPITAL`, and `OPEN_POSITION_REASSESSMENT` is identical; no alias or default purpose is accepted.
24. **Question applicability:** DEE-621 `NOT_REQUIRED` and `NOT_APPLICABLE` receipts create no false need; every other unresolved terminal follows exact classification/blocking policy.
25. **Versioned policy input:** `InformationInquiryPolicyV1` must bind purpose/timeframe relevance and freshness, query/depth/duration/fan-out/result/cost bounds, deterministic per-need/provider cost-unit assignments or exact cost-evaluator identity, contradiction materiality policy and scheduling fairness version/digest. The train defines validation only and supplies no default scientific values.
26. **Per-cycle resolution:** the runtime resolver is invoked after mandatory state with the exact cycle scope/PIT and must return matching profile, receipt and policy identities. Reuse across a mismatched PIT/scope or a missing resolver fails closed with zero optional calls; no global/latest authority fallback.

## A → (B ∥ C) → D

### DEE-696 — contracts and top-down reconstruction

Freeze the shared typed API, exact purpose mapping, `InformationInquiryPolicyV1`, canonical identities, closed vocabularies, five timeframe roles, exact `CONFIRMING | CORRECTIVE | TRANSITIONING | CONFLICTING | UNCLEAR` relation vocabulary, false-gap rules and explicit re-evaluation semantics. Freeze the analogue/Knowledge/Hypothesis query/result identities above. Values such as freshness, relevance, cost/query/fairness bounds and provider candidates remain caller/profile policy inputs with no defaults.

### DEE-697 — bounded planner and inquiry loop

After A freezes the shared API, build deterministic profile-authorized needs, ignored-source lineage, exact contradiction/discriminator/analogue follow-ups, attempt/termination receipts, scheduler and final DEE-621 evaluation seam. Static-vs-trajectory, all four analogue result distinctions, competing-hypothesis discriminators and `NO_APPLICABLE_QUALIFIED_HYPOTHESIS` research routing receive known-answer proofs. No provider is called in this file-disjoint parallel wave.

### DEE-698 — selective live/replay acquisition

After the same A API freeze, wire plan-derived selections into the file-disjoint gateway and historical ingress surfaces. Optional live calls are relevant-only; replay is as-of and network-inert. Mandatory HTX state and explicit unavailable/rejected semantics remain intact.

### DEE-699 — repository closure

Compose the accepted B planner and C two-phase acquisition APIs in standard paper/poll/worker runtime and canonical historical `runBacktest`, then inventory every producer/consumer/bypass and prove the complete threat checklist end to end. Mechanically refresh the Reality inventory and any exact legacy expectation admitted above. No capital implementation authority is added in D.

## Acceptance

1. The standard gateway performs mandatory-first acquisition and never polls an optional provider without an exact validated plan-derived selection.
2. Every plan, selection, attempt and termination is immutable, content-addressed, deterministic, purpose/PIT/profile-relative and explicit about requested and ignored sources.
3. The canonical reconstruction order and roles are exactly `1d → 4h → 1h → 15m → 1m`; lower-timeframe evidence cannot silently overwrite higher-timeframe state.
4. DEE-621 mandatory/context-triggered hard floors, exact substitutions, contradiction policy, freshness, PIT/replay and trust requirements remain non-bypassable.
5. Contradictions, causal-WHY gaps, unavailable sources, exhausted bounds and unresolved explanations terminate honestly without fabricated certainty or synthetic/zero/stale fallback.
6. Historical selection is as-of/PIT safe, deterministic, network-inert and unable to reach future, current-latest or official blind-holdout evidence.
7. Open-position inquiry receives deterministic first priority while a finite fairness rule preserves new-opportunity progress; neither lane gains Decision, Guardian or capital authority.
8. Whole-repository source/consumer/bypass inventories and affected legacy tests close exactly, with unchanged Reality dispositions and DEE-620/621 semantics.
9. Focused, negative, PostgreSQL regression, lint, typecheck, build, canonical/governance, one fresh-SQLite full suite and an independent exact-head zero-P1/P2 review all pass before publication.
10. Exactly one branch, worktree, admitted/frozen manifest, PR and squash merge are used; rollback remains one revert PR.

## Exact local pre-push checklist

Cheap gates run continuously after affected changes; a gate at >120% of its recorded baseline is diagnosed without cancelling a healthy run or launching a duplicate.

```bash
pnpm test --run tests/unit/trader-information-inquiry-contracts.test.ts tests/unit/trader-top-down-market-reconstruction.test.ts
pnpm test --run tests/unit/trader-information-inquiry-analogue-contract.test.ts tests/unit/trader-market-question-evaluation.test.ts tests/unit/trader-market-understanding-bridge.test.ts tests/unit/trader-market-understanding-golden.test.ts
pnpm test --run tests/unit/trader-information-need-planner.test.ts tests/unit/trader-information-inquiry-loop.test.ts tests/unit/trader-information-inquiry-scheduler.test.ts tests/unit/trader-information-inquiry-analogue-planning.test.ts tests/unit/trader-information-sufficiency-contracts.test.ts
pnpm test --run tests/unit/trader-market-data-selective-inquiry.test.ts tests/unit/trader-information-need-replay-selection.test.ts tests/unit/trader-market-data-integration.test.ts tests/unit/trader-market-data-pr25.test.ts tests/unit/trader-htx-bar-poll-source.test.ts tests/integration/trader-htx-bar-poll-cycle.test.ts
pnpm test --run tests/unit/trader-capture-provider-snapshot-selective.test.ts
pnpm test --run tests/unit/trader-wp11-historical-ingress-gateway.test.ts tests/unit/trader-wp11-gateway-parity.test.ts tests/unit/trader-wp11-absent-lanes.test.ts tests/unit/trader-wp11-pit-selection.test.ts tests/unit/trader-wp11-sidecar-v3-timeline.test.ts tests/unit/trader-research-backtest-isolation.test.ts
pnpm test --run tests/unit/trader-information-inquiry-consumer-closure.test.ts tests/unit/trader-information-sufficiency-consumer-closure.test.ts tests/unit/trader-information-sufficiency-runtime.test.ts tests/unit/trader-mi-canonical-source-consumer-closure.test.ts tests/unit/trader-market-data-canonical-pit-bridge.test.ts tests/unit/trader-market-data-canonical-pit-replay.test.ts tests/unit/trader-reality-v2-consumer-graph.test.ts
pnpm test --run tests/integration/trader-information-inquiry-runtime.test.ts tests/integration/trader-paper-cycle-runner.test.ts tests/integration/trader-paper-bar-close-loop.test.ts tests/integration/trader-paper-bar-close-loop-account-state.test.ts tests/integration/trader-paper-bar-close-loop-telemetry.test.ts tests/unit/trader-paper-bar-close-loop.test.ts tests/unit/trader-paper-bar-close-loop-telemetry.test.ts tests/unit/trader-paper-cycle-runner.test.ts tests/unit/trader-paper-loop-worker.test.ts
pnpm test --run tests/unit/trader-information-inquiry-backtest-parity.test.ts
WAIA_PG_INTEGRATION=1 DATABASE_URL_POSTGRES=<permission-correct-loopback-url> pnpm test --run --no-file-parallelism tests/integration/postgres-information-sufficiency-v2.test.ts tests/integration/postgres-mi-canonical-pit-lineage-v1.test.ts
pnpm exec eslint <all changed TypeScript/JSON-aware admitted paths>
pnpm typecheck
pnpm build
./scripts/linear/validate-integration-train-manifest.sh docs/plans/dee-695-top-down-information-inquiry.integration-train.json DEE-695 frozen
pnpm validate:canon
pnpm validate:pr-governance
```

Only after semantic completion and an independent preliminary review, run exactly one expensive local suite on a fresh migrated SQLite database:

```bash
DATABASE_URL=file:/tmp/dee-695-frozen-head.sqlite pnpm db:migrate
DATABASE_URL=file:/tmp/dee-695-frozen-head.sqlite pnpm test --run
```

Then obtain a fresh independent exact-head adversarial review with zero unresolved P1/P2. Only that exact local-green head may be pushed once, opened as one PR to `main`, admitted by authoritative CI/PostgreSQL and unchanged DEE-653 exact-base/head review, and squash-merged when all gates pass.

## STOP and rollback

Stop on any new source/provider classification, concrete relevance/freshness/fairness/scientific formula or threshold, security/retention change, official holdout access, production/live-capital surface, Forecast/Decision/Risk/Execution/Guardian authority, migration collision, remote semantic overlap, or unfixable required gate. Rollback is one revert PR of the squash commit; no destructive migration, deployment, credential operation, release, or live action is authorized.
