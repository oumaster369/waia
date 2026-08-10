---
integrationIssue: DEE-518
integrationTitle: "AI-TRADER Correctness + Mathematical Intelligence + FHV v1 — Implementation Integration"
branch: dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1
riskTier: T1
prPolicy: one-integration-pr
executionSurfaces: [local, cursor-agent, github-actions]
requiredValidation: [lint, typecheck, build, targeted-unit, storage-scale-integration, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
parentIssue: DEE-512
includedIssues:
  - id: DEE-519
    role: work-package
    slug: WP-CANON
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-520
    role: work-package
    slug: WP-EXEC-ACCT
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-521
    role: work-package
    slug: WP-AUTHORITY
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-522
    role: work-package
    slug: WP-FEATURE-RV
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-523
    role: work-package
    slug: WP-FHV-STORAGE
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-524
    role: work-package
    slug: WP-FHV-SERVICE
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-525
    role: work-package
    slug: WP-OBSERVABILITY
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-526
    role: work-package
    slug: WP-VOLUME-QUAL
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-527
    role: work-package
    slug: WP-FORECAST-V2
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-528
    role: work-package
    slug: WP-DECISION-ECON
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-529
    role: work-package
    slug: WP-CONTROL-REPLAY-AUTH
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-530
    role: work-package
    slug: WP-DATASET-QUAL
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-531
    role: work-package
    slug: WP-RESEARCH-HARNESS
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-532
    role: work-package
    slug: WP-EXECOPP-QUAL
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-533
    role: work-package
    slug: WP-PATTERN-RESEARCH
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-534
    role: work-package
    slug: WP-KNOWLEDGE-STATE
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-535
    role: work-package
    slug: WP-CHALLENGER-TRIALS
    completionPolicy: manual-at-integration-ready
    status: pending
postMergeGates:
  - id: DEE-536
    slug: OG-HOST-QUAL
    status: open-after-merge
  - id: DEE-537
    slug: OG-DATA-RECEIPTS
    status: open-after-merge
  - id: DEE-538
    slug: OG-CONTROL-REPLAY
    status: open-after-merge
  - id: DEE-539
    slug: OG-SCI-PACKAGE
    status: open-after-merge
  - id: DEE-540
    slug: OG-HOLDOUT-AUTH
    status: open-after-merge
  - id: DEE-541
    slug: OG-FHV
    status: open-after-merge
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: draft
  currentWorkPackage: WP-CANON
  completedWorkPackages: []
  remainingWorkPackages:
    - WP-CANON
    - WP-EXEC-ACCT
    - WP-AUTHORITY
    - WP-FEATURE-RV
    - WP-FHV-STORAGE
    - WP-FHV-SERVICE
    - WP-OBSERVABILITY
    - WP-VOLUME-QUAL
    - WP-FORECAST-V2
    - WP-DECISION-ECON
    - WP-CONTROL-REPLAY-AUTH
    - WP-DATASET-QUAL
    - WP-RESEARCH-HARNESS
    - WP-EXECOPP-QUAL
    - WP-PATTERN-RESEARCH
    - WP-KNOWLEDGE-STATE
    - WP-CHALLENGER-TRIALS
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Human plan approval (state.status -> approved) after purpose/epistemic/guardian closure review; then /implement starting WP-CANON"
provenance:
  createdFrom: chat
  gateDRatificationSha: 1f10d4eebce23f92dccb3d550e8dc10812d26a9e
  humanRatificationComment: "DEE-516 HUMAN ARCHITECT RATIFICATION — FINAL AI-TRADER GATE-D PACKAGE APPROVED (2026-08-09)"
  hpaCorrection: "HPA-1..HPA-7 applied (2026-08-09); prior commit 8182e97"
  purposeEpistemicGuardianClosure: "P1/P2/P3/E1/E2/N1/G1 applied (2026-08-10); prior commit 2bf582c"
  supersedes: null
---

# DEE-518 — AI-TRADER Correctness + Mathematical Intelligence + FHV v1

## 0. Document control

| Field | Value |
|-------|-------|
| Integration issue | DEE-518 |
| Program parent | DEE-512 |
| Baseline SHA | `1f10d4eebce23f92dccb3d550e8dc10812d26a9e` |
| Branch | `dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1` |
| Delivery | ONE plan → ONE branch → ONE PR → `main` → Human squash merge |
| Child WPs | DEE-519…DEE-535 implement sequentially on this branch; no child branches/PRs |
| Post-merge gates | DEE-536…DEE-541 remain open after merge; not implementation completion |

---

## 1. Global contract

### 1.1 Authority chain (frozen)

`Observation/Data → Feature/Measurement → Hypothesis/Knowledge → CDE/MSV → Forecast → Decision → Risk → Execution → Reality/Reconciliation → Guardian/Exit → Closed Trade → Calibration/Epistemic Closure`

Decision actionability depends **only** on upstream Forecast/calibration/data/economic inputs. Risk is downstream, deterministic, downward-only, economics-blind. No Risk term in `DECISION_ACTIONABLE`.

### 1.2 Scope

Implement the ratified Gate-D scientific/correctness/FHV program on current `main`: execution/accounting repairs, authority enforcement, corrected features, compact Forecast V2, execution-aware Decision economics, bounded FHV storage/service, observability, dataset/volume qualification tooling, research harness, TEST_ONLY Control Replay authority, pattern/challenger research substrate, knowledge state — all in one integration PR unless a proven hard split boundary emerges at pre-PR review.

### 1.3 Non-goals

- Blind holdout access (DEE-540/DEE-541 post-merge only)
- Production capital deployment
- Live trading / Execution Server mutation in implementation PR
- Modulo-9 / digital-root / numeral-base market signals
- Per-sample Monte Carlo row persistence
- `dev` branch resurrection

### 1.4 Historical partitions (verified `fhv-dataset-manifest.ts`)

| Partition | Interval (UTC, half-open) |
|-----------|---------------------------|
| development | `[2020-01-01, 2023-01-01)` |
| walk-forward | `[2023-01-01, 2025-01-01)` |
| blind-holdout | `[2025-01-01, 2026-01-01)` status `SEALED_NOT_ACCESSED` |

### 1.5 Venue / market / symbols

- Venue: HTX SPOT
- Symbols: `BTCUSDT`, `ETHUSDT`
- Bar cadence: 1m closed bars
- Market type: `SPOT`

### 1.6 Initial portfolio (verified `htr-initial-portfolio-constants.ts`)

- `C0 = startingBalanceUsdt = "100000.00"` USDT (`HTR_FHV_RUN_CONTRACT_INITIAL_CASH_USDT`)
- BTC quantity = 0, ETH quantity = 0
- No leverage, borrow, short, external cash flows

### 1.7 Official issuance maximum (exact calendar)

`[2020-01-01, 2026-01-01)` = 2192 UTC days → 3,156,480 1m anchors/symbol → 6,312,960 symbol-cycles → 12,625,920 primary-horizon bundles (30m+60m) → 25,251,840 Forecast records (terminal + execution).

### 1.8 Global invariants

1. `sum(canonical fills) == order.filledQuantity == accounting consumed quantity`
2. `EV_lower <= EV_base <= EV_upper` or `EV_RANGE_INVALID → DECISION_NON_ACTIONABLE`
3. `regenerated_distribution_semantic_digest == sealed_distribution_semantic_digest` or fail-closed
4. FHV hot/checkpoint state O(1) in historical/research length
5. Immutable Forecast V2 evidence `TOTAL_PROJECTED <= 100 GiB`
6. No per-sample relational persistence surface
7. `NO_CHALLENGER_QUALIFIES` preserves blind holdout

### 1.9 Work-package dependency DAG

```
WP-CANON
WP-EXEC-ACCT ─────────────────────────────────────────────┐
WP-AUTHORITY (dep EXEC-ACCT) ─────────────────────────────┤
WP-FEATURE-RV ──────────────────────────────────────────┤
WP-FHV-STORAGE ─────────────────────────────────────────┤
WP-FHV-SERVICE (dep FHV-STORAGE) ───────────────────────┤
WP-OBSERVABILITY (dep FHV-SERVICE) ─────────────────────┤
WP-VOLUME-QUAL ─────────────────────────────────────────┤
WP-FORECAST-V2 (dep CANON, FEATURE-RV) ─────────────────┤
WP-DECISION-ECON (dep FORECAST-V2, EXEC-ACCT, AUTHORITY) ┤
WP-CONTROL-REPLAY-AUTH (dep AUTHORITY, DECISION-ECON) ──┤
WP-DATASET-QUAL ─────────────────────────────────────────┤
WP-RESEARCH-HARNESS (dep FORECAST-V2, DATASET-QUAL) ────┤
WP-EXECOPP-QUAL (dep FORECAST-V2, VOLUME-QUAL, RESEARCH) ┤
WP-PATTERN-RESEARCH (dep RESEARCH-HARNESS) ───────────────┤
WP-KNOWLEDGE-STATE (dep FORECAST-V2) ───────────────────┤
WP-CHALLENGER-TRIALS (dep RESEARCH-HARNESS, FEATURE-RV) ─┘
```

**Parallel-safe groups after dependencies:**
- Group A: WP-CANON (first)
- Group B: WP-EXEC-ACCT, WP-FEATURE-RV, WP-FHV-STORAGE, WP-VOLUME-QUAL, WP-DATASET-QUAL (after WP-CANON)
- Group C: WP-AUTHORITY, WP-FHV-SERVICE, WP-FORECAST-V2
- Group D: WP-OBSERVABILITY, WP-DECISION-ECON, WP-RESEARCH-HARNESS, WP-KNOWLEDGE-STATE
- Group E: WP-CONTROL-REPLAY-AUTH, WP-EXECOPP-QUAL, WP-PATTERN-RESEARCH, WP-CHALLENGER-TRIALS

### 1.10 Migration sequence

Starting after current highest `0109_trader_knowledge_confidence_update_record_rls.sql`:

| Migration | Table / purpose |
|-----------|-----------------|
| 0110 | `trader_forecast_target_definition_v2` |
| 0111 | RLS 0110 |
| 0112 | `trader_forecast_target_bucket_v2` |
| 0113 | RLS 0112 |
| 0114 | `trader_forecast_predictive_package_v2` |
| 0115 | RLS 0114 |
| 0116 | `trader_forecast_predictive_package_target_v2` |
| 0117 | RLS 0116 |
| 0118 | `trader_forecast_replica_artifact_v2` (bytea ≤65536) |
| 0119 | RLS 0118 |
| 0120 | `trader_forecast_bundle_v2` |
| 0121 | RLS 0120 |
| 0122 | `trader_forecast_v2` (compact seal) |
| 0123 | RLS 0122 |
| 0124 | `trader_forecast_scenario_v2` (terminal buckets only) |
| 0125 | RLS 0124 |
| 0126 | `trader_forecast_outcome_v2` |
| 0127 | RLS 0126 |
| 0128 | `trader_forecast_calibration_observation_v2` |
| 0129 | RLS 0128 |
| 0130 | `trader_pattern_definition_v1` (WP-PATTERN-RESEARCH) |
| 0131 | RLS 0130 |
| 0132 | `trader_pattern_occurrence_v1` |
| 0133 | RLS 0132 |
| 0134 | `trader_knowledge_state_checkpoint_v2` (WP-KNOWLEDGE-STATE) |
| 0135 | RLS 0134 |
| 0136 | `trader_research_trial_registration_v1` (WP-RESEARCH-HARNESS) |
| 0137 | RLS 0136 |
| 0138 | `trader_htx_volume_qualification_receipt_v1` (WP-VOLUME-QUAL) |
| 0139 | RLS 0138 |
| 0140 | `trader_intelligence_decision_economics_v2` (WP-DECISION-ECON) |
| 0141 | RLS 0140 |
| 0142 | `trader_scientific_admission_receipt_v1` (WP-EXECOPP-QUAL) |
| 0143 | RLS 0142 |
| 0144 | `trader_control_replay_authority_claim_v1` (WP-CONTROL-REPLAY-AUTH) |
| 0145 | RLS 0144 |

**Final highest migration:** `0145_trader_control_replay_authority_claim_v1_rls.sql`

**WP persistence dispositions (no executor choice):**

| WP | Disposition |
|----|-------------|
| DEE-519 CANON | `NO_SCHEMA_CHANGE` |
| DEE-520 EXEC-ACCT | `NO_SCHEMA_CHANGE` |
| DEE-521 AUTHORITY | `NO_SCHEMA_CHANGE` |
| DEE-522 FEATURE-RV | `NO_SCHEMA_CHANGE` |
| DEE-523 FHV-STORAGE | `NO_SCHEMA_CHANGE` |
| DEE-524 FHV-SERVICE | `NO_SCHEMA_CHANGE` |
| DEE-525 OBSERVABILITY | `NO_SCHEMA_CHANGE` |
| DEE-526 VOLUME-QUAL | `0138`–`0139` |
| DEE-527 FORECAST-V2 | `0110`–`0129` |
| DEE-528 DECISION-ECON | `0140`–`0141` |
| DEE-529 CONTROL-REPLAY-AUTH | `0144`–`0145` |
| DEE-530 DATASET-QUAL | `NO_SCHEMA_CHANGE` (immutable receipts remain filesystem JSON per existing `fhv-dataset-qualification.ts` contract) |
| DEE-531 RESEARCH-HARNESS | `0136`–`0137` |
| DEE-532 EXECOPP-QUAL | `0142`–`0143` |
| DEE-533 PATTERN-RESEARCH | `0130`–`0133` |
| DEE-534 KNOWLEDGE-STATE | `0134`–`0135` |
| DEE-535 CHALLENGER-TRIALS | `NO_SCHEMA_CHANGE` (uses Forecast V2 package artifact tables from `0114`–`0119`) |

All V2 tables: org-scoped composite FKs, append-only block triggers, deferred completeness triggers. V1 tables (`trader_intelligence_forecast_record`, `trader_forecast_outcome_record`) remain quarantined/coexistent.

### 1.11 Test execution strategy

**Per WP:** targeted unit/integration/regression for changed seams only + `pnpm lint`/`pnpm typecheck` on affected paths.

**Integration checkpoints (IC-1…IC-4):**
- IC-1 after WP-EXEC-ACCT + WP-AUTHORITY
- IC-2 after WP-FORECAST-V2 + WP-DECISION-ECON
- IC-3 after WP-FHV-STORAGE + WP-FHV-SERVICE + WP-CONTROL-REPLAY-AUTH
- IC-4 final pre-PR: `pnpm lint && pnpm typecheck && pnpm build` + storage-scale integration test + all targeted suites

**PR CI:** authoritative full unit suite on PR HEAD (no redundant full local suite habit).

### 1.12 Storage / performance budgets

- Per complete bundle (measured): `bytes_per_complete_bundle` from PHASE-1 test
- `TOTAL_PROJECTED = 12_625_920 * bytes_per_complete_bundle + active_package_fixed + enumerated_fixed_V2 <= 100 GiB`
- Per-replica artifact: `<= 65536` bytes; per-package raw artifacts `<= 3_407_872` bytes (trigger-enforced)
- Decision eval: O(K) memory, `<= 1e5` ops/candidate
- Scoring: O(S·d), `<= 1e5` ops/resolution, no O(S²)
- Hot/checkpoint: O(1) in forecast history count

### 1.13 Evidence strategy

Pre-merge: engineering evidence via unit/integration tests + storage-scale test receipts. Post-merge: OG-* gates produce operational/scientific receipts. Prior failed Control Replay economic evidence quarantined as non-authoritative where Gate-A defects applied.

### 1.14 Rollback / versioning

Additive V2 schema only; V1 quarantine. Feature versions pinned (`feature-engine/rv/v2`, `quantizeScale8HalfUp/v1`, `waia-cbrng/sha256-ctr/v1`, `energy-mc/v1`, `cdf-erf-cody715/v1`, `student-t5-cdf-betainc/v1`). Rollback = revert PR; V2 tables orphaned but append-only.

### 1.15 Post-merge gate graph

```
Implementation merge (DEE-518)
  → OG-HOST-QUAL (DEE-536)
  → OG-DATA-RECEIPTS (DEE-537)
  → OG-CONTROL-REPLAY (DEE-538) [NOT blocked on scientific qualification]
  → OG-SCI-PACKAGE (DEE-539) — TWO INTERNAL STAGES (WALK_FORWARD / DEVELOPMENT only; never 2025 holdout):
        STAGE-A PREDICTIVE_SKILL_PASS
          → freeze selected predictive package identity
          → freeze Decision policy / economic semantics version
        STAGE-B LOCKED WALK_FORWARD ECONOMIC-UTILITY QUALIFICATION
          → ECONOMIC_UTILITY_PASS  OR  NO_ECONOMIC_EDGE_QUALIFIES
        ONLY on ECONOMIC_UTILITY_PASS:
          → FROZEN_SELECTED_PACKAGE_READY
  → OG-HOLDOUT-AUTH (DEE-540) [requires CONTROL_REPLAY=PASS AND FROZEN_SELECTED_PACKAGE_READY]
  → OG-FHV (DEE-541)
```

**P1 invariant:** Predictive PnL MUST NOT be the Forecast model-selection score. Economic utility is a separate downstream qualification of an already-frozen predictive package + already-frozen Decision policy. No parameter/model/policy retuning after seeing economic-utility results. `NO_ECONOMIC_EDGE_QUALIFIES` preserves `BLIND_HOLDOUT = SEALED_NOT_ACCESSED`.

See §1.19 for exact economic-utility evidence contract.

### 1.16 Reviewability gate (HPA-7 — criterion-by-criterion)

**Predicted:** ~180–250 files, ~15,000–25,000 changed lines (excluding lockfiles/generated). Exceeds soft ~800-line/~20-file guidance per `INTEGRATION-BOUNDARY-POLICY.md` §Reviewability.

**Canonical MUST-SPLIT criteria** (`INTEGRATION-BOUNDARY-POLICY.md` §When work must split) — evaluated separately:

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Independent deployability | `NO_SPLIT_PROVEN` | Foundation WPs (exec/accounting, authority, FHV storage/service, observability, dataset/volume tooling) are independently *valuable* and may land as incremental commits before intelligence WPs on the same branch. That is reversible intermediate value **within** one integration batch, not proof that two integration issues are mandatory. Intelligence WPs depend on foundation but the Human-ratified DEE-518 topology is explicitly one integration issue owning all children. Deploying foundation-only before intelligence completion is a post-merge operational choice, not a forced pre-merge split boundary. |
| 2 | Different risk tiers / risk boundaries | `NO_SPLIT_PROVEN` | Integration batch risk tier is **T1**. Lower-T2 WPs (CANON, FEATURE-RV, OBSERVABILITY, DATASET-QUAL, PATTERN-RESEARCH, KNOWLEDGE-STATE, CHALLENGER-TRIALS) are subordinate work packages inside one T1 integration issue — not separate integration batches with conflicting tier gates. |
| 3 | Infra vs docs/app separation | `NO_SPLIT_PROVEN` | FHV storage/service are infra-adjacent but causally part of the same AI-TRADER correctness+F HV product integration ratified under DEE-518; no separate infra-only deploy artifact or approval gate exists. |
| 4 | Prerequisite for parallel work | `NO_SPLIT_PROVEN` | DAG defines parallel-safe WP groups on one branch; prerequisite edges are satisfied by sequential WP order, not by spawning a second integration issue. |
| 5 | Unreviewable diff | `NO_SPLIT_PROVEN` (soft exceed only) | Size exceeds soft guidance, but hard "unreviewable" is **not proven**: 17 WP-scoped sections, Appendix A 21-field contracts, incremental commits per WP, IC-1…IC-4 validation gates, and Human Gate-D ratification explicitly retained one-PR default. Pre-PR Human may still judge unreviewable — that would trigger §1.17 contingency, not automatic split now. |
| 6 | Different approval / Human gate | `NO_SPLIT_PROVEN` | Post-merge gates (DEE-536…541) are separate Linear issues with separate Human/operational approval. H3 K/M ratification applies to selected parameters after implementation, not to splitting the implementation PR. |
| 7 | Reversible intermediate value | `NO_SPLIT_PROVEN` | Foundation commits provide reversible intermediate value **inside** the single PR (reviewable commit series). Policy lists this as a split trigger when batches should be *separated* for deploy — a foundation-first deploy path does not mandate a second integration issue while DEE-518 scope remains one approved batch. |

**Soft exceed rationale (not a split trigger):** The diff is large but structurally reviewable: bounded WP boundaries, frozen math in §2, MODEL_TRIAL_SPEC in §4, explicit migration map `0110`–`0145`, and targeted test strategy per WP. Gate-D Human ratification (2026-08-09) explicitly adopted one primary integration issue → one plan → one branch → one PR.

**Verdict:** `ONE_PR_ARCHITECTURALLY_VALID` — retain DEE-518 as sole integration issue. No `DEE_518_MANDATORY_SPLIT_PROVEN`.

### 1.17 Forced-split contingency (not triggered)

If Human proves unreviewable: DEE-512 spawns INTEGRATION-A (WP-EXEC-ACCT…WP-CONTROL-REPLAY-AUTH) and INTEGRATION-B (WP-FORECAST-V2…WP-CHALLENGER-TRIALS) as **separate integration issues**, each with own plan/branch/PR. Never two PRs under one DEE-518.

### 1.18 Integration Definition of Done

- All DEE-519…DEE-535 acceptance criteria met
- IC-4 validation green
- Storage-scale test PASS
- No per-sample forecast table
- Authority firewalls (§1.20–§1.21) encoded and tested
- Epistemic replica + canonical pool contracts (§2.4.1, §4.1) encoded
- FHV-v1 Guardian disposition (§1.22) documented; mature Position Reassessment NOT claimed as FHV-v1 PASS
- Canon/docs/ADRs updated (WP-CANON)
- Plan `state.status: integration-ready`
- PR opened to `main` with governance preflight PASS
- Post-merge gates documented open (DEE-536…541); `FROZEN_SELECTED_PACKAGE_READY` requires ECONOMIC_UTILITY_PASS

### 1.19 Pre-holdout economic-utility qualification (P1)

**Authority sources inspected:** ADR-0010 Strategy Validation Gate; Target Architecture §22; Gate-D ratification. **Finding:** No Human-ratified numeric acceptance threshold for first-program walk-forward economic utility exists. ADR-0010: “quantitative thresholds are set later by the operator and recorded” / “evidence class, not numeric gates.”

**Frozen two-stage gate (inside DEE-539 OG-SCI-PACKAGE):**

1. **PREDICTIVE_SKILL_PASS** — proper predictive scoring vs mandatory baselines (unchanged WP-RESEARCH-HARNESS / WP-EXECOPP-QUAL protocol). Output: freeze `(predictive_package_digest, model_transform_version, K, M, α_epi, decision_policy_version, economic_semantics_version)`.
2. **LOCKED WALK_FORWARD ECONOMIC-UTILITY QUALIFICATION** — apply the **already-frozen** package + Decision policy on WALK_FORWARD only using WP-DECISION-ECON execution-aware economics (fees, spread, impact, participation, partial entry, unfilled cash, post-horizon scientific liquidation, rounding, residual inventory, abstention). **No retuning.**

**Exact evidence produced (executor-fixed; not a menu):**

| Evidence artifact | Content |
|-------------------|---------|
| `economic_utility_receipt.v1` | package digests, decision_policy_version, walk-forward partition digests, cost_model_version, C0, notional grid used for reporting only |
| `cash_null_comparison.v1` | path PnL/equity under selected policy vs pure-cash null (no trades) under identical costs/clock |
| `abstention_summary.v1` | counts/rates of `DECISION_NON_ACTIONABLE` / NO_TRADE |
| `execution_friction_summary.v1` | fees, spread, impact, residual inventory events, unresolved residual fails |
| `economic_utility_terminal_state` | `ECONOMIC_UTILITY_PASS` **or** `NO_ECONOMIC_EDGE_QUALIFIES` |

**Null/cash comparison semantics:** Primary comparison is selected-policy net equity path vs cash-null path on the same WALK_FORWARD clock and cost model. Predictive score / log-score MUST NOT appear as the economic acceptance statistic.

**No-retuning rule:** After STAGE-A freeze, any change to package parameters, Decision policy, cost model, participation, or liquidation doctrine voids the economic-utility run and requires a new STAGE-A freeze identity.

**Terminal states:**

- `ECONOMIC_UTILITY_PASS` → may emit `FROZEN_SELECTED_PACKAGE_READY` only after Human economic-utility ratification (§ below).
- `NO_ECONOMIC_EDGE_QUALIFIES` → durable fail; **MUST** keep `BLIND_HOLDOUT = SEALED_NOT_ACCESSED`; holdout remains closed.

**Human scientific gate (numeric acceptance):** Because ADR-0010 leaves quantitative thresholds operator-set, the numeric PASS rule (e.g. minimum net expectancy, max drawdown, min trade count) is **`HUMAN_ECONOMIC_UTILITY_ACCEPTANCE_V1`** — recorded by Human before STAGE-B may emit PASS. Executor produces evidence only; executor MUST NOT invent the threshold.

### 1.20 Strategy authority disposition (P2)

**V2 authority rule (ONE design):**

```
Knowledge / state
  → Forecast V2 owns predictive distribution
  → Strategy may provide deterministic tactical / action-candidate semantics only
  → Decision V2 owns economic valuation / actionability
```

**Compatibility disposition for legacy fields (ONE choice):**

`StrategySignal.confidence` and `StrategySignal.expectedEdge` are **quarantined non-authoritative legacy diagnostics**.

- Retained on the type for structural compatibility with existing strategy modules / telemetry.
- Renamed in Decision V2 consumers to `legacyDiagnosticConfidence` / `legacyDiagnosticExpectedEdge` when read for logging only.
- **V2 Decision path MUST NOT** derive Forecast probability, EV, conservative EV range, or capital actionability from these fields.
- Gross/net EV for V2 comes solely from Forecast-owned sealed samples + WP-DECISION-ECON payoff functionals `Π_base` / `Π_lower`.

**Regression invariant:** For otherwise identical Forecast V2 / market state / action candidate, mutating legacy strategy `confidence` or `expectedEdge` MUST NOT alter V2 Forecast probabilities, V2 Decision EV range, or V2 Decision actionability.

Strategy eligibility / tactical setup rules remain; this closure is authority ownership only.

### 1.21 Heuristic hypothesis-confidence firewall (P3)

```
legacy/runtime heuristic hypothesis confidence
  ≠ Research Confidence
  ≠ Forecast probability
  ≠ calibration probability
  ≠ Decision Confidence / posture
  ≠ economic EV
```

**Disposition:** Current heuristic hypothesis/conviction may remain **deterministic market-state / permission / eligibility context** where CDE/MSV canon allows. It is **outside** the capital-authoritative Forecast V2 feature vector for first program.

**Forbidden:** probabilizing heuristic confidence as Forecast probability; calibration-scoring it as Forecast confidence; substituting it for a predictive distribution; promoting it to economic authority.

**Regression:** unit/contract tests prove Forecast V2 issuance and Decision V2 EV ignore hypothesis `confidenceValue` / conviction JSON as probability inputs.

### 1.22 FHV-v1 Guardian / Position Reassessment disposition (G1)

**Current main truth (verified):**

| Capability | Status |
|------------|--------|
| Evaluate open lots every cycle | Yes |
| `HOLD` / `EXIT_PARTIAL` / `EXIT_FULL` vocabulary | Yes |
| Permission / strategy-disallowed / max-hold / close-only / stop-trading → EXIT_FULL | Yes |
| ATR stop-loss / take-profit / trailing (when enabled) | Yes (`createSlTpGuardianRuleProvider`); stop never widens |
| Intentional thesis/Forecast/EV invalidation exits | **No** (`invalidation: null` always) |
| Mature remaining-payoff / RR-decay / opportunity-cost reassessment | **No** (Target Architecture §17/**§23 partial**) |
| M5 Exit Intelligence | **Read-only** overlay; does not alter Guardian decisions or emit intents |

**TWO SEPARATE CONTRACTS (must remain distinct):**

| Contract | Role |
|----------|------|
| **A. Scientific precommitted post-horizon liquidation** | Forecast/economic scoring only; entry at N+1..N+3; exit first eligible slice at `t+h+1m`; continue until flat; residual fail-closed. **Must not be altered by runtime Guardian.** |
| **B. Runtime Position Reassessment / Guardian policy** | Manages a genuinely open position under live/FHV inventory rules. **Must not retroactively rewrite scientific target A or create hindsight in A.** |

**FHV-v1 disposition (chosen):** Mature Position Reassessment is **intentionally beyond FHV-v1**.

FHV-v1 validates only the **narrow Guardian policy**:

`permission/max-hold/close-only/stop-trading + optional ATR SL/TP/trailing + inventory-capped partials + read-only Exit Intelligence`.

This is sufficient for FHV-v1 claims of: execution/accounting correctness, authority chain, bounded FHV ops, Forecast/Decision economics under **scientific liquidation A**, and Control Replay. It is **NOT** proof of mature optimal-exit intelligence.

**BLOCKING PRE-LIVE carry-forward (named; Linear issue NOT created in this correction):**

`DEE-518-CARRY-FORWARD-POSITION-REASSESSMENT-PRE-LIVE`

Proposed follow-up (Human-authorized Linear creation later under DEE-512): implement/qualify bounded deterministic Position Reassessment (original/current hypothesis, regime/structure, Forecast-admissible remaining EV of HOLD vs EXIT, RR decay, invalidation, time-in-trade, data/event risk, exposure/opportunity cost) with Risk/kill constraints and stop-never-widens — **after** DEE-541 and **before** any live-capital readiness claim.

**WP-AUTHORITY scope for DEE-518:** enforce Decision→Risk→Execution + kill fold; document Guardian FHV-v1 narrow policy; **do not** implement mature Position Reassessment inside DEE-518.

---

## 2. Frozen mathematical contracts (reference — must not change)

### 2.1 Primary target

`Y^R_{t,h} = log(P_{t+h} / P_t)` for `h ∈ {30, 60}` minutes.

### 2.2 RV (corrected)

`r_i = log(close_i / close_{i-1})`; `realizedVar20m_1m = Σ_{i=1}^{20} r_i²`; `realizedVol20m_1m = sqrt(Σ r_i²)`. No demeaning. No annualization. PIT window `(t-20m, t]`. Missing bar → `UNAVAILABLE`.

### 2.3 Execution Opportunity 13-D vector

`[R_1,R_2,R_3,R_h,R_{h+1},R_{h+2},R_{h+3},V_1,V_2,V_3,V_{h+1},V_{h+2},V_{h+3}]` with `R_k = log(P_{t+k}/P_t)`.

### 2.4 Decision economics + epistemic replicas (Gate-D F2 recovered)

Per epistemic replica `k` and aleatoric draws `m`:

`mu_base_k(a) = mean_m Pi_base(a, x_{k,m})`

`mu_lower_k(a) = mean_m Pi_lower(a, x_{k,m})`

Type-7 quantiles over `{mu_*_k}`:

`EV_base = Q_0.50(mu_base_k)`

`EV_lower = Q_0.10(mu_lower_k)`

`EV_upper = Q_0.90(mu_base_k)`

Invariant: `EV_lower <= EV_base <= EV_upper` else `EV_RANGE_INVALID → DECISION_NON_ACTIONABLE`.

`DECISION_ACTIONABLE ⇔ EV_lower > 0` + upstream data/calibration/scientific-admission gates. **No Risk allowance term. No StrategySignal.confidence/expectedEdge term.**

#### 2.4.1 What K means vs what M means (E1 — P0)

| Symbol | Meaning (Gate-D F2 recovered; must not be redefined) |
|--------|------------------------------------------------------|
| **K** | Number of **epistemic model replicas**. Replica `k` is a **DEVELOPMENT-only deterministic stationary-bootstrap refit** of the forecast model — **not** a separate Monte Carlo sample stream from one fitted F. Variation across `{mu_k}` is epistemic model uncertainty. |
| **M** | Number of **aleatoric draws** from replica `k`'s predictive distribution `F_t^(k)` at issuance. Changing M reduces Monte Carlo error in `mu_k`; it does **not** redefine epistemic dispersion. |
| **S** | `S = K·M` total ephemeral samples for Decision/scoring (never persisted as rows). |
| **α_epi** | First-program `0.10` (Human H3 before capital). |

**Replica construction (all EXECUTOR_READY packages, including §4.1):**

1. Let `D` = canonical DEVELOPMENT eligible-anchor corpus for `(symbol,h)` (§2.4.2).
2. For each `k ∈ {0..K-1}`:
   - `seed_k = uint32_be(SHA-256("epi-bootstrap/v1" ‖ predictive_package_id ‖ uint32_be(k))[0:4])`
   - Draw a **stationary-bootstrap resample** `D_k` of `D` with expected block length `L = ceil(n_D^(1/3))` using `WAIA_RANDOM_BLOCK_V1` domain `epi-bootstrap/v1` and seed material `seed_k` (unbiased block starts via rejection; no mutable PRNG).
   - **Refit** model parameters on `D_k` only (for §4.1: type-7 tertile edges + state-conditional pools on `D_k`).
   - Seal replica artifact `A_k` (edges, pool digests, counts, bootstrap seed, `model_transform_version`) with `model_artifact_digest`.
3. At issuance `t`, replica `k` produces `F_t^(k)` and emits M aleatoric samples using domain `aleatoric-draw/v1` with ordinals `(k, m, draw)` — **separate** from bootstrap seeds.
4. Decision consumes regenerated samples; never persists sample rows.

**Forbidden redefinition:** Using `(replica,sample,draw)` ordinals merely to draw from **one** shared fitted pool — that collapses K into Monte Carlo noise and **invalidates** `Q_0.10/0.50/0.90(mu_k)` as epistemic EV.

**Proof tests:**

- Holding K fixed, increasing M reduces within-replica variance of `mu_k` estimators (Monte Carlo error ↓).
- Holding M fixed, replicas with distinct bootstrap seeds produce distinct sealed artifacts / edges when DEVELOPMENT has genuine dispersion.
- Identical `(D, package_id, K, M, seeds)` regenerates identical digests.

#### 2.4.2 Canonical empirical pool order / reconstruction (E2)

Index sampling addresses a **canonical pool**, never filesystem/DB return order.

For every `(symbol, h, state, replica_k)` pool:

| Field | Frozen rule |
|-------|-------------|
| DEVELOPMENT dataset digest/ref | Official FHV dataset qualification digest for DEVELOPMENT partition |
| Feature version | `feature-engine/rv/v2` |
| Target/outcome contract | 13-D EXECUTION_OPPORTUNITY + TERMINAL `R_h` marginal; outcome version `exec-opp-outcome/v1` |
| PIT eligibility | Anchor `t` eligible iff all required future closes/volumes for the 13-D vector exist and no look-ahead features used |
| State assignment version | `rv-state-tertile/v1` using replica `k`'s sealed edges |
| Canonical anchor identity | `(venue=HTX, market=SPOT, symbol, closed_bar_epoch_ms)` |
| Exact canonical ordering | Sort ascending by `closed_bar_epoch_ms`, tie-break by `bar_content_digest` lexicographic ascending |
| Duplicate/tie handling | Duplicate `(symbol, closed_bar_epoch_ms)` → fail closed `POOL_DUPLICATE_ANCHOR`; equal digests at same epoch impossible after duplicate check |
| Outcome vector serialization | Fixed 13 × scale-8 HALF_UP canonical strings, UTF-8, `\n`-joined, for digest only |
| Pool length | `n_pool` after eligibility filter on `D_k` |
| Pool semantic digest | `SHA-256("pool/v1" ‖ identity fields ‖ ordered anchor ids ‖ outcome serialization stream)` |
| Reconstruction | From qualified DEVELOPMENT corpus + replica bootstrap seed + feature/outcome versions — **no** unbounded duplicate pool blob persistence |
| Verification before sampling | Recompute `pool_semantic_digest`; mismatch → `FORECAST_POOL_REPLAY_MISMATCH` fail closed |

**Persistence bound:** seal only compact replica artifacts (edges, digests, seeds, counts ≤64 KiB). Reconstruct pools on demand from DEVELOPMENT corpus.

### 2.5 Quantizer `quantizeScale8HalfUp/v1` (FORECAST-ONLY)

Decode IEEE-754 binary64 to exact rational `(sign, mantissa, exponent2)`; value = `sign * mantissa * 2^exponent2`; multiply by `10^8`; integer HALF_UP (ties away from zero); emit fixed 8-decimal canonical string. Reject non-finite.

**Scope boundary:** `quantizeScale8HalfUp/v1` applies **only** to Forecast generative canonicalization and sealed distribution digests. It does **not** replace existing Risk/execution arithmetic.

### 2.5.1 Current Risk/execution numeric semantics (verified `lib/trader/risk/numeric.ts` + execution paths — HPA-5)

**`lib/trader/risk/numeric.ts` (shared scale-8 integer layer):**

| Operation | Semantics |
|-----------|-----------|
| `parseDecimal` / `formatDecimal` | Reject inputs with **>8** fractional digits; no rounding — parse error |
| `multiplyDecimal(a,b)` | `(parseDecimal(a) * parseDecimal(b)) / 10^8` — **BigInt integer division truncates toward zero** |
| `divideDecimal(a,b)` | `(parseDecimal(a) * 10^8) / parseDecimal(b)` — **truncates toward zero** |
| `addDecimal` / `subtractDecimal` | Exact integer add/subtract at scale 8 |
| `floorDecimal` | Identity on already-valid scale-8 scaled integer (misnamed; no floor beyond parse) |

**There is NO HALF_UP quantizer in `lib/trader/risk/numeric.ts`.**

**Execution economics path (`lib/trader/execution/fill-economics.ts`) — separate local rounding:**

| Operation | Semantics |
|-----------|-----------|
| `multiplyBpsRoundHalfUp(notional, bps)` | `fee/spread/impact bps` amounts: **HALF_UP** at scale 8 via local `roundHalfUpScaled` |
| `divideRoundHalfUp(numerator, denominator)` | Used in net-fill price derivation: **HALF_UP** via `roundHalfUpScaled` on doubled intermediate |
| `multiplyDecimal` (imported) | `grossNotional = price × qty` — **truncation toward zero** per risk numeric |
| `parseDecimal` sums | Fee component aggregation — exact integer |

**Other execution seams:**

| Seam | Semantics |
|------|-----------|
| `historical-simulated-exchange.ts` | `multiplyDecimal` for participation capacity; `parseDecimal` for qty stepping — **truncation toward zero** |
| `execution-service.ts` | `divideDecimal` / `multiplyDecimal` for avg-fill reconciliation — **truncation toward zero** |
| `cost-model.ts` (live path) | `multiplyDecimal` / `divideDecimal` for slippage/fee — **truncation toward zero** |

**WP-EXEC-ACCT rule:** Preserve the above semantics exactly. Do not change Risk/execution rounding to Forecast `quantizeScale8HalfUp/v1`. Any future HALF_UP unification requires explicit separate Human-approved change.

### 2.6 RNG `WAIA_RANDOM_BLOCK_V1`

64-byte preimage: `MAGIC(8)="WAIACBR1" | domain_tag(8) | root_seed(32) | replica_u32 | sample_u32 | draw_u32 | retry_u32`. `block = SHA256(preimage)`; `word = uint64_be(block[0:8])`; `u = (word >> 11) / 2^53`; unbiased `[0,K)` via rejection (`t = 2^64 mod K`).

### 2.7 Scoring streams

- `scoring_stream_identity_digest` = contract identity hash
- `scoring_stream_semantic_digest` = streaming hash of actual uint53 numerators `U_s[d]` for `s=0..S-1`, `d=0..D_SCORE_MAX-1` (`D_SCORE_MAX=16`; index 0 = replica selection)
- **Do not hash scale-8-quantized uniforms for RNG verification**

### 2.8 energy-mc/v1

`MC_ES = (1/S)Σ||x_s-y||_2 - (1/(2J))Σ||x_{2j-1}-x_{2j}||_2` on normalized 13-D space; O(S·d); Monte Carlo estimate not exact all-pairs score.

### 2.9 Qualified runtime tuple (authoritative determinism boundary)

`{os_class, arch, node_version_exact, code_release_sha, sampler_contract_version, model_transform_version, quantizer_version, artifact_digest}` — equality guaranteed only inside OG-HOST-QUAL receipt match. No universal cross-platform bit-equality claim.

---

## 3. Work packages

### WP-CANON — DEE-519

**Purpose:** Ratify Gate-D + P1–P3/G1 purpose/authority/guardian dispositions in-repo without inventing architecture.

**Current seams:** `docs/ai-trader/*.md`, `docs/adr/`, `AGENTS.md`, `docs/AI-TRADER-PRODUCT-CONSTITUTION.md`, `docs/ai-trader/AI-TRADER-MASTER-SPEC-v2.md`.

**Files:** LD-6 §4-MV + §4-MV.2 amendments; LD-7 conservative-EV + DECISION_ACTIONABLE boundary; LD-8 kill fold; new ADRs (compact Forecast seal, bytea artifacts, waia-cbrng, quantizer); Master Spec §8.2/§14; Target Architecture re-ratification note; `AGENTS.md` routing.

**Design:** Document-only reconciliation; no runtime behavior change.

**Forbidden:** Silent canon override; second competing architecture doc.

**Fail-closed codes:** N/A (docs).

**Tests:** `pnpm validate:pr-governance`; markdown link lint if present.

**Dependencies:** none (first WP).

**Risk:** T2.

**DoD:** All ratified amendments committed; Human ratification references preserved.

**Human gate:** Architect acceptance of amendment package (already ratified 2026-08-09; this WP records in-repo).

---

### WP-EXEC-ACCT — DEE-520

**Purpose:** Close Gate-A execution/accounting defects; uninterrupted run == checkpoint+resume semantic parity.

**Current seams:**
- `lib/trader/execution/historical-simulated-exchange.ts` — `advanceOnClosedBar`, stale `entry.order`
- `lib/trader/execution/execution-service.ts` — `recordSimulatedFill`
- `lib/trader/execution/repository-postgres.ts` — `recordFillPostgres`
- `lib/trader/execution/fill-economics.ts` — fee 20 / spread 5 / impact 10 bps
- `lib/trader/observability/fhv-execution-checkpoint.ts` — zero-default `orderFillFrontier` digest (L559)
- `lib/trader/execution/fhv-hot-state-pruner.ts` — seal frontier semantics

**Design (ONE):** Change `HistoricalExecutionPersistencePort.recordSimulatedFill` to `Promise<OrderRow>`; `advanceOnClosedBar` assigns returned fresh order. Symbol guard: reject fill if `bar.symbol !== order.symbol`. Checkpoint frontier digest from authoritative fill sequence not zero placeholder.

**Invariants:**
- `sum(fills.qty) == order.filledQuantity`
- avg fill price from fresh order state
- symbol isolation on every fill path
- resume parity digest matches uninterrupted run

**Formulas:** per-fill economics via `applyHistoricalExecutionEconomics` (scale-8 truncation in risk numeric — unchanged).

**Time semantics:** closed-bar eligibility N+1..N+3 entry; exit t+h+1m first slice.

**Tests:** multi-slice fill regression; symbol mismatch rejection; checkpoint/resume parity (`htr-wp22-checkpoint-resume-parity.ts` extension); frontier digest non-zero.

**Evidence invalidation:** Prior failed Control Replay fill/accounting evidence non-authoritative.

**Dependencies:** none (parallel with CANON).

**Risk:** T1.

**DoD:** All Gate-A defects covered by automated tests; IC-1 partial.

---

### WP-AUTHORITY — DEE-521

**Purpose:** Enforce `Forecast → Decision → Risk → Execution` and kill/flatten/HALT fold; encode Strategy/Hypothesis authority firewalls; document FHV-v1 narrow Guardian policy (§1.22).

**Current seams:**
- `lib/trader/intelligence/forecast-decision/build-decision-record.ts`
- `lib/trader/risk/risk-engine-service.ts`, `kill-switch-service.ts`, `kill-switch-enforcement.ts`
- `lib/trader/guardian/evaluate-position-guardian.ts`, `map-exit-intent-to-submit-order.ts`
- `lib/trader/guardian/htr-breach-partial-entry-cancellation.ts`
- `lib/trader/intelligence/strategies/*`, `lib/trader/intelligence/hypothesis/*`

**Design:** Decision record has no Risk-allowance input and **no** StrategySignal confidence/expectedEdge economic input. Kill fold state machine: `TRIPPED → revoke exposure-increasing allowances → cancel pending entries → CLOSE_ONLY → FLATTEN → RECONCILE → HALT`. Risk verdict set: `APPROVE | APPROVE_CLAMPED | VETO | CLOSE_ONLY | HALT`. Guardian FHV-v1 = mechanical narrow policy only; mature Position Reassessment deferred (§1.22).

**Forbidden:** Decision consulting downstream Risk allowance; Decision using legacy strategy edge/confidence for EV/actionability; post-HALT emergency trading; claiming FHV-v1 proves mature exit intelligence.

**Tests:** authority ordering regression; kill-fold integration; strategy-mutation non-effect on V2 EV; hypothesis-confidence firewall.

**Dependencies:** WP-EXEC-ACCT.

**Risk:** T1.

**DoD:** Causal chain + firewall tests pass; Guardian disposition documented in canon (WP-CANON).

---

### WP-FEATURE-RV — DEE-522

**Purpose:** Correct RV semantics; rename price-level std to `priceDispersion20`.

**Current seam:** `lib/trader/intelligence/feature-engine-v0.ts:148` — `realizedVol20` uses price-level std.

**Design:** Add `realizedVar20m_1m`, `realizedVol20m_1m`; deprecate `realizedVol20` → `priceDispersion20`. Feature version `feature-engine/rv/v2`.

**Formulas:** §2.2 exactly.

**Known-answer:** constant price → RV=0; fixed log-step g → `RV=sqrt(20)*g`; missing bar → UNAVAILABLE.

**Tests:** `tests/unit/feature-engine-rv-v2.test.ts`; update `feature-engine-parity.ts` consumers.

**Dependencies:** none.

**Risk:** T2.

**DoD:** `realizedVol20m_1m` available for challengers and state conditioning.

---

### WP-FHV-STORAGE — DEE-523

**Purpose:** ADR-0025 bounded hot state, native clone, retry taxonomy, disk safety.

**Current seams:** `fhv-native-clone.ts`, `fhv-hot-state-pruner.ts`, `fhv-economic-ledger.ts`, `fhv-host-storage-policy.ts`, `fhv-execution-checkpoint*.ts`.

**Design:** Strict native clone (`cp -c` / `cp --reflink=always`); no immutable-base+delta official fallback; semantic failure → no auto-retry; ENOSPC → fail-closed; artifact lifecycle `CANONICAL_EVIDENCE|ACTIVE_STATE|PROVEN_ORPHAN|TEMPORARY`; disk preflight gates.

**Storage budget:** hot state O(1); no history-proportional checkpoint growth.

**Tests:** native-clone probe; retry classifier; disk gate unit tests; bounded hot-state scale property.

**Dependencies:** none.

**Risk:** T1.

**DoD:** Gate-C architecture encoded; ADR-0025 compliance tests.

---

### WP-FHV-SERVICE — DEE-524

**Purpose:** Durable server-owned execution, claims, T4A finalization regression.

**Current seams:** `fhv-authorization-claim.ts`, `fhv-t4a-phase-receipts.ts`, `fhv-t4a-operator-executor.ts`, `fhv-rehearsal-campaign-runner.ts`.

**Design:** Heartbeat/dead-process detection; claim lifecycle; final receipt reconstructable from durable evidence; Step 28/30/31/32 proof-digest loss impossible.

**Dependencies:** WP-FHV-STORAGE.

**Risk:** T1.

**DoD:** T4A durability regression tests; stale RUNNING claim fixed.

---

### WP-OBSERVABILITY — DEE-525

**Purpose:** Authoritative Admin/FHV producers; `UNAVAILABLE` not fabricated zero.

**Current seams:** `build-fhv-operator-status-v1.ts`, `fhv-full-historical-progress.ts`, `fhv-status-writer.ts`, `app/(trader)/admin/fhv-operations/`.

**Required producers:** run state, historical timestamp, partition, percent, cycles/sec, ETA, heartbeat, checkpoint, CPU, RAM, disk, projected exhaustion, DB growth, evidence growth, cash, equity, PnL, fees, spread, impact, drawdown, orders, fills, positions, regime, hypothesis, Guardian vetoes, alerts, receipt state.

**Dependencies:** WP-FHV-SERVICE.

**Risk:** T2.

**DoD:** Each field has authoritative source or explicit `UNAVAILABLE`.

---

### WP-VOLUME-QUAL — DEE-526

**Purpose:** HTX volume unit qualification; fail-closed.

**Current seams:** `htx-kline-mapper.ts` (`volume = row.amount ?? row.vol`), `bar-integrity-gate.ts`, `fhv-bars-v2-ndjson.ts`.

**Design:** Emit exactly `HTX_VOLUME_AUTHORITY_QUALIFIED` or `HTX_VOLUME_AUTHORITY_BLOCKED_<REASON>`. No replacement capacity model on block.

**Dependencies:** none.

**Risk:** T1.

**DoD:** Qualification receipt schema + CLI; capital path blocked on BLOCKED.

---

### WP-FORECAST-V2 — DEE-527

**Purpose:** Compact sealed Terminal + Execution Opportunity Forecast V2 substrate.

**Current seams:** migrations 0082/0102 (V1), `build-forecast-records.ts`, `calibration-scorer.ts`.

**Design:** Implement migrations 0110–0129 (§1.10). Package-level `bytea` artifacts ≤64KiB/replica. Per-forecast compact seal with `distribution_semantic_digest`. `trader_forecast_predictive_package_target_v2` two-role binding. `quantizeScale8HalfUp/v1` + `WAIA_RANDOM_BLOCK_V1`. No `trader_forecast_exec_sample_v2`. Terminal = deterministic projection of package onto `R_h`. **Epistemic replicas** = DEVELOPMENT stationary-bootstrap refits (§2.4.1); **canonical pools** (§2.4.2). Heuristic hypothesis confidence is **not** a Forecast V2 probability input (§1.21).

**Fail-closed:** `FORECAST_DISTRIBUTION_REPLAY_MISMATCH`, `FORECAST_MODEL_ARTIFACT_DIGEST_MISMATCH`, `EXEC_OPP_NORMALIZATION_DEGENERATE_COMPONENT`, `FORECAST_RUNTIME_QUALIFICATION_MISMATCH`.

**Storage test:** PHASE 0–3 protocol (§8 below).

**Dependencies:** WP-CANON, WP-FEATURE-RV.

**Risk:** T1.

**DoD:** Storage-scale integration test PASS; replay determinism tests; bundle completeness triggers.

---

### WP-DECISION-ECON — DEE-528

**Purpose:** Execution-aware conservative Decision economics; fail-closed without admission receipt; Strategy/Hypothesis non-authority.

**Current seams:** `build-decision-record.ts`, `forecast-decision-service.ts`, `historical-simulated-exchange.ts`, `cost-model.ts`.

**Design:** O(K) streaming EV over regenerated sample streams from **epistemic replicas** (§2.4.1). Post-horizon **scientific** participation-sliced liquidation (Contract A, §1.22); residual lower floor 0 USDT in `Pi_lower`. `DECISION_ACTIONABLE` without Risk term and without StrategySignal confidence/expectedEdge. Capital admission consumes scientific-admission receipt; economic-utility PASS is required before `FROZEN_SELECTED_PACKAGE_READY` (§1.19). Emit interfaces for STAGE-B economic-utility evidence consumers.

**Forbidden:** Risk in actionability; legacy strategy edge as EV; heuristic hypothesis confidence as probability; using runtime Guardian exits to rewrite scientific liquidation A; retuning after economic-utility results.

**Dependencies:** WP-FORECAST-V2, WP-EXEC-ACCT, WP-AUTHORITY. **NOT** hard-dep WP-EXECOPP-QUAL (runtime receipt only).

**Risk:** T1.

**DoD:** EV ordering tests; firewall regressions; fail-closed without receipt; scientific liquidation mechanics tests; economic-utility receipt schema ready for OG-SCI-PACKAGE STAGE-B.

**Human gate:** H3 before capital; `HUMAN_ECONOMIC_UTILITY_ACCEPTANCE_V1` before STAGE-B PASS.

---

### WP-CONTROL-REPLAY-AUTH — DEE-529

**Purpose:** `CONTROL_REPLAY_TEST_ONLY_AUTHORITY_V1`; `controlReplayParityDigest`.

**Current seams:** `fhv-control-replay-execution.ts`, `fhv-execution-purpose.ts`, `semantic-parity-digest.ts`, `replay-repro-digest.ts`.

**Identity:** `executionPurpose=CONTROL_REPLAY`, `executionMode=mock`, `authorityClass=TEST_ONLY`, `capitalEligible=false`.

**Design:** Deterministic sealed test fixtures; real Decision→Risk→Execution path; `computeControlReplayParityDigest` over normalized surface; production/FULL_HISTORICAL/shadow/live fail closed on TEST_ONLY.

**Dependencies:** WP-AUTHORITY, WP-DECISION-ECON (mechanics complete fail-closed).

**Risk:** T1.

**DoD:** Two-run parity digest equality test; escape-prevention tests.

---

### WP-DATASET-QUAL — DEE-530

**Purpose:** Real-data acquisition/provenance/partition qualification tooling.

**Current seams:** `fhv-dataset-manifest.ts`, `fhv-dataset-qualification.ts`, `fhv-partition-boundaries.ts`, `scripts/trader/fhv-dataset-qualification-cli.ts`.

**Design:** Immutable qualification receipts; holdout redaction; PIT boundary enforcement; gap/duplicate policy.

**Dependencies:** none.

**Risk:** T2.

**DoD:** CLI produces receipt matching manifest digests.

---

### WP-RESEARCH-HARNESS — DEE-531

**Purpose:** Preregistered baselines, bootstrap, Holm FWER, target-grid ceremony, CDF kernels.

**Current seams:** new `lib/trader/research/benchmark/*`.

**Terminal baselines (frozen §1 of user spec):** climatology; Gaussian σ=dev pop std; Student-t ν=5 scale=σ√(3/5); rolling W=2000; EWMA λ=0.94 warm-up 2000.

**Gaussian CDF kernel `cdf-erf-cody715/v1`:** Complete transcription of ACM TOMS 715 `CALERF` path for `erf(x)` (`JINT=0`). Primary source: Cody CALERF in SPECFUN / Netlib `erf.f`.

**Identity:** `cdf-erf-cody715/v1`. Normal CDF: `Phi(z) = 0.5 * (1 + erf(z / sqrt(2)))` where `sqrt(2)` is the IEEE-754 binary64 literal.

**Mathematical constants:**

```
FOUR = 4.0
ONE = 1.0
HALF = 0.5
TWO = 2.0
ZERO = 0.0
SQRPI = 0.56418958354775628695   // 1/sqrt(pi)
THRESH = 0.46875
SIXTEN = 16.0
```

**Machine-dependent constants (IEEE binary64 defaults, frozen):**

```
XINF = 1.79e308
XNEG = -26.628
XSMALL = 1.11e-16
XBIG = 26.543
XHUGE = 6.71e7
XMAX = 2.53e307
```

**Coefficient arrays (1-based indexing as in source):**

```
A[1..5] = [3.16112374387056560, 1.13864154151050156e2, 3.77485237685302021e2,
           3.20937758913846947e3, 1.85777706184603153e-1]
B[1..4] = [2.36012909523441209e1, 2.44024637934444173e2,
           1.28261652607737228e3, 2.84423683343917062e3]
C[1..9] = [5.64188496988670089e-1, 8.88314979438837594, 6.61191906371416295e1,
           2.98635138197400131e2, 8.81952221241769090e2, 1.71204761263407058e3,
           2.05107837782607147e3, 1.23033935479799725e3, 2.15311535474403846e-8]
D[1..8] = [1.57449261107098347e1, 1.17693950891312499e2, 5.37181101862009858e2,
           1.62138957456669019e3, 3.29079923573345963e3, 4.36261909014324716e3,
           3.43936767414372164e3, 1.23033935480374942e3]
P[1..6] = [3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1,
           1.60837851487422766e-2, 6.58749161529837803e-4, 1.63153871373020978e-2]
Q[1..5] = [2.56852019228982242, 1.87295284992346047, 5.27905102951428412e-1,
           6.05183413124413191e-2, 2.33520497626869185e-3]
```

**Algorithm `erf(x)` — `JINT=0`:**

```
X = x
Y = abs(X)

IF Y <= THRESH:
  // Branch B1: |x| <= 0.46875 — direct erf rational
  IF Y > XSMALL:
    YSQ = Y * Y
  ELSE:
    YSQ = 0
  XNUM = A[5] * YSQ
  XDEN = YSQ
  FOR I = 1 TO 3:
    XNUM = (XNUM + A[I]) * YSQ
    XDEN = (XDEN + B[I]) * YSQ
  RESULT = X * (XNUM + A[4]) / (XDEN + B[4])
  RETURN RESULT

ELSE IF Y <= FOUR:
  // Branch B2: 0.46875 < |x| <= 4.0 — erfc rational then erf = 1 - erfc
  XNUM = C[9] * Y
  XDEN = Y
  FOR I = 1 TO 7:
    XNUM = (XNUM + C[I]) * Y
    XDEN = (XDEN + D[I]) * Y
  RESULT = (XNUM + C[8]) / (XDEN + D[8])
  YSQ = floor(Y * SIXTEN) / SIXTEN          // AINT(Y*16)/16
  DEL = (Y - YSQ) * (Y + YSQ)
  RESULT = exp(-YSQ*YSQ) * exp(-DEL) * RESULT
  // JINT=0 fixup (label 300):
  RESULT = (HALF - RESULT) + HALF            // 1 - erfc
  IF X < 0:
    RESULT = -RESULT
  RETURN RESULT

ELSE:
  // Branch B3: |x| > 4.0 — asymptotic erfc then erf = 1 - erfc
  RESULT = 0
  IF Y >= XBIG:
    IF Y >= XMAX:
      GOTO fixup_300
    IF Y >= XHUGE:
      RESULT = SQRPI / Y
      GOTO fixup_300
  YSQ = 1 / (Y * Y)
  XNUM = P[6] * YSQ
  XDEN = YSQ
  FOR I = 1 TO 4:
    XNUM = (XNUM + P[I]) * YSQ
    XDEN = (XDEN + Q[I]) * YSQ
  RESULT = YSQ * (XNUM + P[5]) / (XDEN + Q[5])
  RESULT = (SQRPI - RESULT) / Y
  YSQ = floor(Y * SIXTEN) / SIXTEN
  DEL = (Y - YSQ) * (Y + YSQ)
  RESULT = exp(-YSQ*YSQ) * exp(-DEL) * RESULT
fixup_300:
  RESULT = (HALF - RESULT) + HALF
  IF X < 0:
    RESULT = -RESULT
  RETURN RESULT
```

**Underflow/saturation:** For `|x| > XBIG` in erfc path used by B2/B3, `erfc → 0`, hence `erf → 1` (within floating limits). No separate erfcx path is used for `Phi`.

**Known-answer vectors (mandatory per branch):** `x ∈ {0, ±1e-8, ±0.46874, ±0.46875, ±0.46876, ±3.999, ±4.0, ±4.001, ±6, ±26, ±40}` compared against reference `erf` implementation (mpmath/high-precision) during test authoring only.

**Student-t5 CDF `student-t5-cdf-betainc/v1` (HPA-2 corrected + N1 complete kernel):**

For standard Student-t with `ν=5`, location `μ=0`, scale `s>0`:

```
z = (x - μ) / s
x_beta = ν / (ν + z²)     // ν = 5
a = ν/2 = 2.5
b = 0.5
I = betai(a, b, x_beta)   // regularized incomplete beta Ix(a,b) via betainc-lentz/v1 below
```

**CDF:**

```
IF z < 0:  F(z) = 0.5 * I
IF z == 0: F(z) = 0.5
IF z > 0:  F(z) = 1 - 0.5 * I
```

Equivalent for `z != 0`: `F(z) = 0.5 + 0.5 * sign(z) * (1 - I)`.

**Limits:** `F(-∞) = 0`, `F(0) = 0.5`, `F(+∞) = 1`.

**Baseline scale:** `s = sigma_dev * sqrt(3/5)`.

---

##### `betainc-lentz/v1` — complete regularized incomplete-beta kernel (N1)

Primary source: Numerical Recipes incomplete-beta continued fraction (Press et al.), modified Lentz §5.2 / §6.4. Identity: `betainc-lentz/v1`. **No library substitution. No “standard Lentz” phrase without the recurrence below.**

**Outer regularized incomplete beta `betai(a,b,x) = I_x(a,b)`:**

```
Constants:
  MAX_ITER = 200
  TOL = 1e-15          // |del - 1| convergence on CF
  FPMIN = 1.0e-30      // Lentz tiny guard

Domain:
  IF x < 0 OR x > 1 → fail CDF_DOMAIN_ERROR
  IF x == 0 → return 0
  IF x == 1 → return 1
  IF a <= 0 OR b <= 0 OR non-finite(a,b,x) → fail CDF_DOMAIN_ERROR

Front factor:
  bt = exp( lgamma(a+b) - lgamma(a) - lgamma(b) + a*ln(x) + b*ln(1-x) )
  // overflow/underflow of bt: if non-finite → fail CDF_KERNEL_OVERFLOW

Symmetry condition:
  IF x < (a+1)/(a+b+2):
    // direct CF
    cf = betacf(a, b, x)           // modified Lentz below
    return bt * cf / a
  ELSE:
    // symmetry: I_x(a,b) = 1 - I_{1-x}(b,a)
    cf = betacf(b, a, 1-x)
    return 1 - bt * cf / b
```

**Continued fraction `betacf(a,b,x)` — modified Lentz with even+odd steps per iteration:**

Coefficients (NR 6.4.6):

```
d_{2m+1} = - (a+m)(a+b+m) x / ( (a+2m)(a+2m+1) )
d_{2m}   =   m(b-m) x / ( (a+2m-1)(a+2m) )
```

Algorithm:

```
qab = a + b
qap = a + 1
qam = a - 1

// First Lentz step
c = 1
d = 1 - qab * x / qap
IF abs(d) < FPMIN: d = FPMIN
d = 1 / d
h = d

FOR m = 1 .. MAX_ITER:
  m2 = 2 * m

  // EVEN step
  aa = m * (b - m) * x / ( (qam + m2) * (a + m2) )
  d = 1 + aa * d
  IF abs(d) < FPMIN: d = FPMIN
  c = 1 + aa / c
  IF abs(c) < FPMIN: c = FPMIN
  d = 1 / d
  h = h * d * c

  // ODD step
  aa = - (a + m) * (qab + m) * x / ( (a + m2) * (qap + m2) )
  d = 1 + aa * d
  IF abs(d) < FPMIN: d = FPMIN
  c = 1 + aa / c
  IF abs(c) < FPMIN: c = FPMIN
  d = 1 / d
  del = d * c
  h = h * del

  IF abs(del - 1) < TOL:
    RETURN h   // converged

fail CDF_KERNEL_NON_CONVERGENT
```

**Non-convergence / overflow reason codes:** `CDF_KERNEL_NON_CONVERGENT`, `CDF_KERNEL_OVERFLOW`, `CDF_DOMAIN_ERROR`.

**Known-answer vectors for Student-t5 standard CDF** (`s=1`, `ν=5`) — frozen for deterministic tests (computed via `betainc-lentz/v1`; no runtime network/high-precision dependency):

| z | F(z) |
|---|------|
| 0 | `0.50000000000000000000` |
| −0.5 | `0.31914943582046462200` |
| +0.5 | `0.68085056417953537800` |
| −1 | `0.18160873382456199643` |
| +1 | `0.81839126617543800357` |
| −2 | `0.05096973941492919519` |
| +2 | `0.94903026058507078400` |
| −5 | `0.00205235799002666036` |
| +5 | `0.99794764200997332360` |

Symmetric check: `F(z) + F(−z) = 1` within `1e-15` absolute for finite z≠0.

**Validation protocol:** log score; stationary bootstrap L=ceil(n^(1/3)), B=10000, seed=SHA256(trial_id) mod 2^32; Holm FWER 0.05; common anchor set per (symbol,h,challenger); purge/embargo=h; beat EVERY mandatory baseline.

**Target grid ceremony:** dev quantiles {0.05,0.20,0.40,0.60,0.80,0.95} → 7 buckets; `authority_status=RESEARCH_ONLY` until Human ratified.

**Dependencies:** WP-FORECAST-V2, WP-DATASET-QUAL.

**Risk:** T1.

**DoD:** Bootstrap determinism known-answer; Holm known-answer; CDF kernel vectors vs § frozen table; betainc-lentz recurrence tests; epistemic K≠M separation property tests.

---

### WP-EXECOPP-QUAL — DEE-532

**Purpose:** Joint Execution Opportunity qualification + K/M convergence gate; emits STAGE-A scientific-admission inputs (predictive), not economic-utility PASS.

**Joint baselines:** `empirical-joint/v1` (unbiased dev anchor index); `marginal-independence/v1` (type-7 empirical inverse CDF per component).

**K/M grid:** K∈{10,20,30,40,50}, M∈{20,40,80} (15 configs); reference (50,80); 4096 anchors/cell = 16384 total; scale grid {0.01,0.05,0.10,0.25,0.50}·C0; ev_rate=EV/notional; relative error denominator max(|ev_rate_ref|,5e-5); 95th-pct max over notionals; thresholds 0.01 EV / 0.02 MC_ES.

**Dependencies:** WP-FORECAST-V2, WP-VOLUME-QUAL, WP-RESEARCH-HARNESS.

**Risk:** T1.

**DoD:** K/M selection receipt; predictive scientific-admission receipt for STAGE-A; does **not** alone emit `FROZEN_SELECTED_PACKAGE_READY`.

**Human gate:** H3 ratification of selected K,M,α_epi=0.10 before capital eligibility.

---

### WP-PATTERN-RESEARCH — DEE-533

**Purpose:** RESEARCH_ONLY pattern/recurrence substrate.

**Design:** `Measurement → Pattern Definition → Occurrence → recurrence evidence → Hypothesis`. Persist pattern-definition digest, quantizer version, occurrence timestamps, recurrence stats. **Forbidden:** digital-root, modulo-9, 1-2-4-8-7-5, 3-6-9 signals; direct Decision/CDE/Risk/capital authority.

**Dynamical ablation ladder (research):** level → +slope → +curvature → +tau normalization → +hazard (all RESEARCH_ONLY).

**Dependencies:** WP-RESEARCH-HARNESS.

**Risk:** T2.

**DoD:** Pattern tables + occurrence API; no capital path wiring.

---

### WP-KNOWLEDGE-STATE — DEE-534

**Purpose:** Bounded replay-deterministic model/calibration/epistemic checkpoint state.

**Current seams:** `trader_knowledge_confidence_update_record` (0108), intelligence records.

**Design:** Versioned checkpoint of model version, calibration snapshot, rejected/promoted research states, knowledge semantic digest. Distinct from FHV hot state.

**Dependencies:** WP-FORECAST-V2.

**Risk:** T2.

**DoD:** Replay restores identical knowledge digest.

---

### WP-CHALLENGER-TRIALS — DEE-535

**Purpose:** First research-only probabilistic challengers for harness evaluation.

See §4 MODEL_TRIAL_SPEC registry.

**Dependencies:** WP-RESEARCH-HARNESS, WP-FEATURE-RV.

**Risk:** T2.

**DoD:** At least one full-joint EXECUTOR_READY challenger (`rv-state-conditional-empirical-joint/v1`) integrated with harness; others RESEARCH_ONLY or UNIMPLEMENTED per §4.

---

## 4. MODEL_TRIAL_SPEC registry (DEE-535)

### 4.0 Same-package coherence invariant (HPA-1)

For each `(symbol, primary_horizon)` predictive package:

1. **TERMINAL_RETURN** Forecast at horizon `h` and **EXECUTION_OPPORTUNITY** Forecast at horizon `h+3` share one predictive-package/model lineage.
2. TERMINAL_RETURN is the **exact `R_h` marginal** of the sealed joint predictive distribution — not a separate side model.
3. Terminal bucket probabilities are computed from that exact marginal only.
4. Execution Opportunity scoring (`energy-mc/v1`) consumes the **same** joint sample set.
5. **No Decision-side probability reconciliation** exists.
6. Package is PIT-safe; model fitting uses DEVELOPMENT partition only.
7. Sampler/artifact/replay semantics are fully frozen (`WAIA_RANDOM_BLOCK_V1`, `quantizeScale8HalfUp/v1`, `distribution_semantic_digest`).
8. A package that reaches STAGE-A predictive pass may become `FROZEN_SELECTED_PACKAGE_READY` **only after** STAGE-B `ECONOMIC_UTILITY_PASS` (§1.19).

Any challenger marked `EXECUTOR_READY` must satisfy all eight points.

---

### 4.1 `rv-state-conditional-empirical-joint/v1` — **EXECUTOR_READY**

Full-joint conditional empirical challenger with **Gate-D epistemic bootstrap replicas**. Terminal and Execution Opportunity are deterministic projections of the **same** sealed joint sample set **per replica**.

| Field | Specification |
|-------|---------------|
| Package roles | `TERMINAL_RETURN` @ `h` + `EXECUTION_OPPORTUNITY` @ `h+3` from one package |
| State variable (PIT) | `realizedVol20m_1m` at anchor `t` from `feature-engine/rv/v2` — uses only closes in `(t-20m, t]` |
| **Epistemic replica k** | Stationary-bootstrap **refit** of DEVELOPMENT corpus `D` → `D_k` (§2.4.1). On `D_k`, compute type-7 tertile edges `{q1_k,q2_k}` and state-conditional pools. **Edges are refit per replica** — not fixed from a single parent fit. |
| State boundaries (per replica) | On `D_k` only: empirical tertiles `p ∈ {1/3, 2/3}` via type-7 on `realizedVol20m_1m` → `q1_k < q2_k` |
| State assignment at `t` for replica k | Using **replica k edges**: `S0` if `rv ≤ q1_k`; `S1` if `q1_k < rv ≤ q2_k`; `S2` if `rv > q2_k` (`rv==q1_k → S0`; `rv==q2_k → S1`) |
| Replica training pool | Canonical ordered eligible anchors in `D_k` with PIT-valid resolved 13-D outcomes and state assignment under edges `(q1_k,q2_k)` — reconstruction §2.4.2 |
| Min pool count | If `|pool_{k,state}| < 30` → that replica marks state `UNAVAILABLE` at anchors needing it; if all states empty → `FORECAST_UNAVAILABLE_STATE_EMPTY` |
| **Aleatoric draws m** | From replica k's sealed state pool only: unbiased index via `WAIA_RANDOM_BLOCK_V1` domain `aleatoric-draw/v1`, ordinals `(k,m,draw)`; emit observed 13-D vector — **no parametric density** |
| Terminal marginal | `R_h` component of **the same** joint samples for replica k; bucket masses from empirical frequencies of those samples |
| Execution Opportunity | Complete 13-D samples from the **same** replica-k sample stream |
| Coherence | Unit test: per sealed issuance, terminal bucket masses = `R_h` marginal of joint samples within `1e-12` |
| Artifact schema (≤64KiB / replica) | `{q1,q2,state_edges_version:"type7-tertile/v1", pool_digest_S0,S1,S2, n_S0,n_S1,n_S2, bootstrap_seed, L_block, symbol, h, fit_partition:"development", replica_ordinal}` |
| model_transform_version | `rv-state-conditional-empirical-joint/v1` |
| Parent package seal | `K` replica artifacts + package digest over ordered replica digests; no shared single-pool shortcut |
| Scoring | Same harness protocol; comparable to unconditional `empirical-joint/v1` on common PIT-valid anchors |
| Known-answer | Synthetic DEVELOPMENT with known bootstrap seeds → distinct replica edges; M↑ reduces `mu_k` MC error |
| Compute budget | Fit: O(K · \|D\|) once; issuance: O(M) after pool reconstruct |
| Scientific validity | Full-joint; epistemic K via bootstrap refits; aleatoric M separated; PIT-safe; falsifiable vs unconditional empirical-joint |

---

### 4.2 `har-rv-terminal/v1` — **RESEARCH_ONLY_UNIMPLEMENTED_HAR_JOINT_SPEC_NOT_FROZEN**

Terminal-only HAR-RV spec rejected (HPA-4): overlapping RV aggregation double-counts squared returns; future RV target window undefined; `log(0)` absent; `sigma_cap` arbitrary; terminal Gaussian not coherent with joint package. May remain research backlog only after a complete full-joint HAR package is separately frozen from primary literature.

---

### 4.3 `garch11-terminal/v1` — **RESEARCH_ONLY_UNIMPLEMENTED_NONLINEAR_OPTIMIZER_NOT_FROZEN**

GARCH(1,1) requires constrained QMLE with ω>0, α≥0, β≥0, α+β<1 and convergence semantics not executor-frozen in Gate-D.

---

### 4.4 `ordinal-ridge-terminal/v1` — **RESEARCH_ONLY_UNIMPLEMENTED_FEATURE_SET_NOT_PINNED**

Regularized ordinal model requires pinned feature vector version beyond `feature-engine/rv/v2` scope.

---

### 4.5 `joint-locscale-execopp/v1` — **RESEARCH_ONLY_UNIMPLEMENTED_MULTIVARIATE_DENSITY_NOT_FROZEN**

Parametric joint location-scale model beyond empirical baselines requires additional Human scientific design.

---

### 4.6 `dynamical-state-ablation/v1` — **RESEARCH_ONLY** (owned by WP-PATTERN-RESEARCH substrate; not capital)

---

## 5. PostgreSQL storage-scale test (WP-FORECAST-V2 DoD)

**Runtime:** CI-pinned PostgreSQL major (record `server_version` in receipt).

**PHASE 0 — EMPTY:** migrate clean; `B0 = Σ pg_total_relation_size(relid)` over enumerated V2 relations (tables+indexes+TOAST).

**PHASE 1 — COMPLETE BUNDLES:** `N=200_000` complete bundles (1 terminal + 1 execution + bundle + outcomes + calibration + ≤7 scenarios + ≤7 buckets each); `VACUUM (ANALYZE)`; `CHECKPOINT`; `B1`; `bytes_per_complete_bundle = (B1 - B0 - package_fixed_contribution) / N`.

**PHASE 2 — PACKAGES:** fresh DB; insert max active package set (4 cells × current admitted packages × 50 replicas × 64KiB); measure `package_fixed_contribution`.

**PHASE 3 — HOT/CHECKPOINT:** FHV harness proves checkpoint bytes independent of N bundles.

**Projection:** `TOTAL_PROJECTED = 12_625_920 * bytes_per_complete_bundle + package_fixed + fixed_V2_other`.

**FAIL if:** any per-sample table exists; `TOTAL_PROJECTED > 100 GiB`; `bytes_per_complete_bundle > 4096`; hot/checkpoint scales with N; O(S²) scorer present.

---

## 6. Human gates remaining after plan approval

| Gate | Owner | Blocks |
|------|-------|--------|
| Plan approval | Human | `/implement` start |
| H3 K/M + α_epi=0.10 | Human | capital eligibility |
| Target grid `HUMAN_RATIFIED_CAPITAL` | Human | capital terminal forecasts |
| `HUMAN_ECONOMIC_UTILITY_ACCEPTANCE_V1` | Human | STAGE-B ECONOMIC_UTILITY_PASS numeric rule |
| OG-HOST-QUAL runtime tuple | Measured | authoritative replay |
| OG-DATA-RECEIPTS | Measured | Control Replay |
| OG-CONTROL-REPLAY | Measured | holdout path |
| OG-SCI-PACKAGE STAGE-A/B | Measured + Human | `FROZEN_SELECTED_PACKAGE_READY` |
| OG-HOLDOUT-AUTH | Human one-shot | FHV (requires CONTROL_REPLAY=PASS **and** FROZEN_SELECTED_PACKAGE_READY) |
| Squash merge | Human | production tip |
| Position Reassessment pre-live | Human (future Linear) | live-capital readiness after DEE-541 |

---

## 7. Evidence invalidation summary

| Evidence class | Disposition |
|----------------|-------------|
| Failed Control Replay fill/accounting | non-authoritative |
| V1 forecast records | quarantined; coexist |
| Old `realizedVol20` (price std) | superseded by `realizedVol20m_1m` |
| Unbounded generation copies / ENOSPC runs | forensic only |

---

## 8. Plan adversarial self-QA (plan-only)

| Check | Status |
|-------|--------|
| Units/time semantics frozen | ✓ |
| Decision/Risk ordering | ✓ |
| Predictive skill ≠ economic utility (P1) | ✓ (§1.15, §1.19) |
| Strategy not second economic brain (P2) | ✓ (§1.20) |
| Hypothesis confidence firewall (P3) | ✓ (§1.21) |
| Epistemic K = bootstrap refits; M = aleatoric (E1) | ✓ (§2.4.1) |
| Canonical pool order/reconstruction (E2) | ✓ (§2.4.2) |
| Complete betainc-lentz/v1 recurrence (N1) | ✓ |
| Student-t5 CDF limits F(-∞)=0, F(0)=0.5, F(+∞)=1 | ✓ |
| Full-joint EXECUTOR_READY challenger | ✓ `rv-state-conditional-empirical-joint/v1` |
| Terminal = exact R_h marginal of same joint package | ✓ |
| HAR not falsely executor-ready | ✓ |
| Guardian FHV-v1 vs mature Position Reassessment (G1) | ✓ (§1.22) |
| Scientific liquidation ≠ runtime Guardian | ✓ |
| No optional/as-needed persistence decisions | ✓ migrations `0110`–`0145` |
| Quantizer not falsely attributed to risk numeric | ✓ (§2.5.1) |
| Complete Cody CALERF algorithm frozen | ✓ |
| One PR topology with honest HPA-7 criterion pass | ✓ |
| Post-merge gates not claimed in PR | ✓ |

**No unresolved plan blocker identified.**

---

## Appendix A — Full work-package contracts (21-field)

Each WP below uses the mandatory 21-field executor contract. Implementation occurs on branch `dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1` only.

### A.1 WP-CANON (DEE-519)

| # | Contract |
|---|----------|
| 1 Purpose | Record Gate-D ratified canon amendments in-repo |
| 2 Current seams | `docs/ai-trader/`, `docs/adr/`, `AGENTS.md`, Master Spec, Target Arch |
| 3 Files | LD-6/7/8 amendment markdown; ADR-0029 compact forecast; ADR-0030 quantizer; ADR-0031 cbrng; routing updates |
| 4 Formulas | N/A (references §2 frozen math) |
| 5 Time semantics | N/A |
| 6 Data inputs | DEE-516 Human ratification comment 2026-08-09 |
| 7 Persistence | N/A |
| 8 Design | Single docs-only reconciliation PR slice; no runtime |
| 9 Forbidden | Silent override of ratified math; second architecture bible |
| 10 Fail-closed | N/A |
| 11 Known-answer | Governance preflight scripts |
| 12 Tests | `pnpm validate:pr-governance` |
| 13 PIT | N/A |
| 14 Replay | N/A |
| 15 Budget | N/A |
| 16 Migration | N/A |
| 17 Evidence | Prior ambiguous canon superseded by explicit amendments |
| 18 Dependencies | none |
| 19 Risk | T2 |
| 20 DoD | All amendments committed; cross-links valid |
| 21 Human gate | Architect ratification recorded (done); plan approval pending |

### A.2 WP-EXEC-ACCT (DEE-520)

| # | Contract |
|---|----------|
| 1 Purpose | Repair Gate-A execution/accounting; resume parity |
| 2 Seams | `historical-simulated-exchange.ts:advanceOnClosedBar`, `execution-service.ts`, `repository-postgres.ts:recordFillPostgres`, `fhv-execution-checkpoint.ts` |
| 3 Files | above + `tests/unit/execution-multi-slice.test.ts`, `tests/unit/fhv-checkpoint-frontier-digest.test.ts` |
| 4 Formulas | fill economics: fee 20bps, half-spread 5bps, impact 10bps on notional (USDT); bps amounts via `fill-economics.ts` local **HALF_UP**; price×qty via `multiplyDecimal` **truncation toward zero** per `risk/numeric.ts` |
| 5 Time | entry eligible N+1..N+3 closed bars; no same-bar hindsight |
| 6 Inputs | closed 1m bars, order row, symbol |
| 7 Persistence | `trader_orders`, `trader_fills`, `trader_fill_execution_economics` |
| 8 Design | `recordSimulatedFill(): Promise<OrderRow>`; refresh order in loop; symbol guard before fill |
| 9 Forbidden | stale in-memory order; cross-symbol bar consumption; zero frontier digest |
| 10 Fail-closed | `SYMBOL_MISMATCH_FILL_REJECTED`, `FILL_QUANTITY_INVARIANT_BREACH` |
| 11 KA | 3-slice partial fill sums to order qty |
| 12 Tests | unit multi-slice; integration checkpoint-resume; regression wp17 harness |
| 13 PIT | fills only on closed bars ≤ t |
| 14 Replay | uninterrupted vs resume digest match |
| 15 Budget | O(1) per bar |
| 16 Migration | none |
| 17 Evidence | failed Control Replay economics quarantined |
| 18 Dependencies | none |
| 19 Risk | T1 |
| 20 DoD | Gate-A invariants tested |
| 21 Human | none |

### A.3 WP-AUTHORITY (DEE-521)

| # | Contract |
|---|----------|
| 1 Purpose | Causal Decision→Risk→Execution; kill fold; Strategy/Hypothesis firewalls; FHV-v1 narrow Guardian |
| 2 Seams | `build-decision-record.ts`, `risk-engine-service.ts`, `kill-switch-service.ts`, `evaluate-position-guardian.ts`, `htr-breach-partial-entry-cancellation.ts`, strategies/*, hypothesis/* |
| 3 Files | above + authority ordering + firewall tests |
| 4 Formulas | N/A (Risk economics-blind) |
| 5 Time | kill fold immediate on trip; flatten until flat |
| 6 Inputs | Decision record, Risk limits, Guardian state |
| 7 Persistence | `trader_kill_switches`, decision/risk audit tables |
| 8 Design | Explicit state machine; Decision excludes Risk allowance and StrategySignal EV; Guardian FHV-v1 mechanical only |
| 9 Forbidden | Decision reading Risk allowance; StrategySignal→EV; claiming mature Position Reassessment in FHV-v1 |
| 10 Fail-closed | `KILL_SWITCH_TRIPPED`, `HALT_ACTIVE` |
| 11 KA | trip → CLOSE_ONLY within 1 cycle |
| 12 Tests | ordering regression; kill-fold; strategy-mutation non-effect; hypothesis firewall |
| 13 PIT | N/A |
| 14 Replay | deterministic kill sequence |
| 15 Budget | O(1) |
| 16 Migration | none |
| 17 Evidence | N/A |
| 18 Dependencies | WP-EXEC-ACCT |
| 19 Risk | T1 |
| 20 DoD | authority + firewall tests green; G1 disposition documented |
| 21 Human | none |

### A.4 WP-FEATURE-RV (DEE-522)

| # | Contract |
|---|----------|
| 1 Purpose | Correct RV; rename price dispersion |
| 2 Seams | `feature-engine-v0.ts:148`, `feature-engine-parity.ts`, `types.ts` |
| 3 Files | `lib/trader/intelligence/feature-engine-v0.ts`, `tests/unit/feature-engine-rv-v2.test.ts` |
| 4 Formulas | §2.2 exactly |
| 5 Time | PIT window (t-20m,t]; 21 closes |
| 6 Inputs | closed 1m OHLCV |
| 7 Persistence | feature snapshot in cycle envelope |
| 8 Design | add fields; deprecate alias |
| 9 Forbidden | calling price std "realizedVol" |
| 10 Fail-closed | UNAVAILABLE on missing bars |
| 11 KA | §2.2 vectors |
| 12 Tests | unit KA; parity harness update |
| 13 PIT | no future closes |
| 14 Replay | feature digest stable |
| 15 Budget | O(20) per snapshot |
| 16 Migration | feature version bump |
| 17 Evidence | old vol-based calibration quarantined |
| 18 Dependencies | none |
| 19 Risk | T2 |
| 20 DoD | `realizedVol20m_1m` consumed by `rv-state-conditional-empirical-joint/v1` |
| 21 Human | none |

### A.5 WP-FHV-STORAGE (DEE-523)

| # | Contract |
|---|----------|
| 1 Purpose | ADR-0025 bounded storage architecture |
| 2 Seams | `fhv-native-clone.ts`, `fhv-hot-state-pruner.ts`, `fhv-economic-ledger.ts`, `fhv-host-storage-policy.ts` |
| 3 Files | above + retry classifier module + disk gate tests |
| 4 Formulas | disk preflight: `required_bytes = hot + checkpoint + safety_reserve` |
| 5 Time | checkpoint epoch boundaries |
| 6 Inputs | host storage stats, generation paths |
| 7 Persistence | WAL segments, checkpoint bundles |
| 8 Design | strict native clone; bounded hot; artifact lifecycle states |
| 9 Forbidden | full-DB generation copies; unbounded retry; base+delta official fallback |
| 10 Fail-closed | `ENOSPC_FAIL_CLOSED`, `NATIVE_CLONE_UNAVAILABLE` |
| 11 KA | clone probe on qualified host fixture |
| 12 Tests | storage policy unit; hot-state bound property |
| 13 PIT | N/A |
| 14 Replay | checkpoint bundle restore |
| 15 Budget | hot O(1) history |
| 16 Migration | none |
| 17 Evidence | ENOSPC campaign forensic only |
| 18 Dependencies | none |
| 19 Risk | T1 |
| 20 DoD | Gate-C tests pass |
| 21 Human | OG-HOST-QUAL for production host |

### A.6 WP-FHV-SERVICE (DEE-524)

| # | Contract |
|---|----------|
| 1 Purpose | Durable server-owned long-run execution |
| 2 Seams | `fhv-authorization-claim.ts`, `fhv-t4a-*`, `fhv-rehearsal-campaign-runner.ts` |
| 3 Files | service lifecycle module + T4A regression tests |
| 4 Formulas | N/A |
| 5 Time | heartbeat interval pinned in config freeze |
| 6 Inputs | authorization receipt, run claim |
| 7 Persistence | launch receipts, T4A phase receipts |
| 8 Design | server process ownership; dead detection; durable proof before transport tail |
| 9 Forbidden | SSH-owned semantic state; stale RUNNING without heartbeat |
| 10 Fail-closed | `CLAIM_STALE`, `FINALIZATION_PROOF_MISSING` |
| 11 KA | simulated crash → recover receipt |
| 12 Tests | T4A step regression matrix |
| 13 PIT | N/A |
| 14 Replay | receipt reconstructable |
| 15 Budget | O(1) claim metadata |
| 16 Migration | none |
| 17 Evidence | T4A failed run preserved forensic |
| 18 Dependencies | WP-FHV-STORAGE |
| 19 Risk | T1 |
| 20 DoD | T4A durability tests |
| 21 Human | server deploy post-merge |

### A.7 WP-OBSERVABILITY (DEE-525)

| # | Contract |
|---|----------|
| 1 Purpose | Authoritative operator surface |
| 2 Seams | `build-fhv-operator-status-v1.ts`, `fhv-full-historical-progress.ts`, admin UI |
| 3 Files | observability producers map + admin bindings |
| 4 Formulas | ETA = remaining_cycles / smoothed_cps |
| 5 Time | wall clock for heartbeat only; historical ts from replay cursor |
| 6 Inputs | checkpoint, accounting, progress files |
| 7 Persistence | `fhv-operator-status.v1.json`, progress jsonl |
| 8 Design | producer registry with UNAVAILABLE fallback |
| 9 Forbidden | fabricated zero |
| 10 Fail-closed | field=UNAVAILABLE when no producer |
| 11 KA | missing file → UNAVAILABLE not 0 |
| 12 Tests | producer contract tests |
| 13 PIT | N/A |
| 14 Replay | N/A |
| 15 Budget | O(1) read status |
| 16 Migration | none |
| 17 Evidence | N/A |
| 18 Dependencies | WP-FHV-SERVICE |
| 19 Risk | T2 |
| 20 DoD | all required fields mapped |
| 21 Human | none |

### A.8 WP-VOLUME-QUAL (DEE-526)

| # | Contract |
|---|----------|
| 1 Purpose | HTX volume unit qualification |
| 2 Seams | `htx-kline-mapper.ts`, `fhv-bars-v2-ndjson.ts`, `bar-integrity-gate.ts` |
| 3 Files | `lib/trader/market-data/volume-qualification/*`, CLI extension |
| 4 Formulas | N/A (dimensional proof) |
| 5 Time | manifest-sealed bars |
| 6 Inputs | HTX kline fields amount/vol, symbol map |
| 7 Persistence | `trader_htx_volume_qualification_receipt_v1` (`0138`–`0139`) |
| 8 Design | lineage proof → QUALIFIED or BLOCKED reason |
| 9 Forbidden | assuming base volume without proof |
| 10 Fail-closed | `HTX_VOLUME_AUTHORITY_BLOCKED_*` |
| 11 KA | synthetic manifest with known unit |
| 12 Tests | receipt schema; fail-closed capital gate |
| 13 PIT | N/A |
| 14 Replay | receipt digest stable |
| 15 Budget | streaming scan |
| 16 Migration | `0138`–`0139` |
| 17 Evidence | unqualified volume non-authoritative |
| 18 Dependencies | none |
| 19 Risk | T1 |
| 20 DoD | verdict enum tested |
| 21 Human | AUTH-CHANGE if BLOCKED |

### A.9 WP-FORECAST-V2 (DEE-527)

| # | Contract |
|---|----------|
| 1 Purpose | Compact sealed Forecast V2 |
| 2 Seams | 0082/0102 V1, `build-forecast-records.ts`, new migrations 0110-0129 |
| 3 Files | `lib/trader/intelligence/forecast-v2/*`, migrations, `quantizeScale8HalfUp/v1`, `waia-cbrng` |
| 4 Formulas | §2.1-2.9 |
| 5 Time | seal at t; horizons h and h+3; PIT evidence cutoff |
| 6 Inputs | package artifact, feature snapshot, normalization digest |
| 7 Persistence | tables §1.10; bytea ≤65536; no sample rows |
| 8 Design | generative seal + distribution_semantic_digest |
| 9 Forbidden | per-sample rows; weight text; cross-symbol package bind |
| 10 Fail-closed | §2.9 codes + bundle incompleteness DB abort |
| 11 KA | quantizer vectors; RNG block vectors; replay digest |
| 12 Tests | storage-scale integration; bundle triggers; replay |
| 13 PIT | no future anchor in seal |
| 14 Replay | distribution digest match |
| 15 Budget | §1.12 |
| 16 Migration | 0110-0129 additive |
| 17 Evidence | V1 quarantined |
| 18 Dependencies | CANON, FEATURE-RV |
| 19 Risk | T1 |
| 20 DoD | storage test PASS |
| 21 Human | grid ratification; runtime tuple OG-HOST-QUAL |

### A.10 WP-DECISION-ECON (DEE-528)

| # | Contract |
|---|----------|
| 1 Purpose | Execution-aware conservative Decision economics |
| 2 Seams | `build-decision-record.ts`, `forecast-decision-service.ts`, `historical-simulated-exchange.ts` |
| 3 Files | `lib/trader/intelligence/decision-economics/*` |
| 4 Formulas | §2.4; Pi from participation model; residual lower 0 USDT |
| 5 Time | exit first slice t+h+1m |
| 6 Inputs | sealed forecasts; scientific-admission receipt required for capital path (table `0142`–`0143`); STAGE-B economic-utility uses frozen package+policy |
| 7 Persistence | `trader_intelligence_decision_economics_v2` (`0140`–`0141`) |
| 8 Design | O(K) streaming quantiles over epistemic replicas; Strategy/Hypothesis non-authority; scientific liquidation Contract A |
| 9 Forbidden | Risk in actionability; StrategySignal EV; hypothesis confidence as probability; retuning after economic utility |
| 10 Fail-closed | `EV_RANGE_INVALID`, `DECISION_NON_ACTIONABLE` |
| 11 KA | ordering EV_lower≤base≤upper; strategy-mutation non-effect |
| 12 Tests | economics unit; liquidation integration; firewall regressions; economic-utility receipt schema |
| 13 PIT | forecasts sealed ≤t |
| 14 Replay | EV deterministic per seal |
| 15 Budget | O(K) memory |
| 16 Migration | `0140`–`0141` |
| 17 Evidence | N/A |
| 18 Dependencies | FORECAST-V2, EXEC-ACCT, AUTHORITY |
| 19 Risk | T1 |
| 20 DoD | fail-closed + mechanics + firewalls + STAGE-B evidence interfaces |
| 21 Human | H3; HUMAN_ECONOMIC_UTILITY_ACCEPTANCE_V1 |

### A.11 WP-CONTROL-REPLAY-AUTH (DEE-529)

| # | Contract |
|---|----------|
| 1 Purpose | TEST_ONLY Control Replay authority |
| 2 Seams | `fhv-control-replay-execution.ts`, `fhv-execution-purpose.ts` |
| 3 Files | `control-replay-test-authority.ts`, `fhv-control-replay-parity-digest.ts` |
| 4 Formulas | parity digest over normalized surface |
| 5 Time | CONTROL_REPLAY bounded fixture or qualified dataset window |
| 6 Inputs | TEST_ONLY sealed fixture seed |
| 7 Persistence | `trader_control_replay_authority_claim_v1` (`0144`–`0145`) + config freeze digest |
| 8 Design | fixtures through real Risk/Execution |
| 9 Forbidden | bypass Risk/Execution; TEST_ONLY in production |
| 10 Fail-closed | `TEST_ONLY_AUTHORITY_REJECTED` |
| 11 KA | two-run parity digest equal |
| 12 Tests | escape prevention; partial fill path |
| 13 PIT | N/A |
| 14 Replay | parity digest |
| 15 Budget | bounded fixture |
| 16 Migration | `0144`–`0145` |
| 17 Evidence | N/A |
| 18 Dependencies | AUTHORITY, DECISION-ECON |
| 19 Risk | T1 |
| 20 DoD | OG-CONTROL-REPLAY ready post-merge |
| 21 Human | none |

### A.12 WP-DATASET-QUAL (DEE-530)

| # | Contract |
|---|----------|
| 1 Purpose | Real-data qualification tooling |
| 2 Seams | `fhv-dataset-qualification.ts`, manifest v1/v2 |
| 3 Files | CLI + receipt validators |
| 4 Formulas | manifest digest SHA-256 |
| 5 Time | partition boundaries exact |
| 6 Inputs | NDJSON bars, HTX provenance |
| 7 Persistence | qualification receipt |
| 8 Design | streaming qualify; holdout never read for fit |
| 9 Forbidden | holdout contamination |
| 10 Fail-closed | `DATASET_QUALIFICATION_FAILED` |
| 11 KA | known manifest hash |
| 12 Tests | CLI integration |
| 13 PIT | partition guards |
| 14 Replay | receipt reproducible |
| 15 Budget | streaming O(1) memory |
| 16 Migration | none |
| 17 Evidence | synthetic ≠ official |
| 18 Dependencies | none |
| 19 Risk | T2 |
| 20 DoD | receipt schema tested |
| 21 Human | OG-DATA-RECEIPTS execution |

### A.13 WP-RESEARCH-HARNESS (DEE-531)

| # | Contract |
|---|----------|
| 1 Purpose | Scientific benchmark harness |
| 2 Seams | new `lib/trader/research/benchmark/*` |
| 3 Files | baselines, bootstrap, holm, cdf kernels |
| 4 Formulas | §WP-RESEARCH-HARNESS + Cody coefficients literal |
| 5 Time | purge/embargo h |
| 6 Inputs | outcomes, forecasts, trial_id |
| 7 Persistence | trial registration records |
| 8 Design | common anchor set; Holm FWER 0.05 |
| 9 Forbidden | executor-chosen stats; BH-FDR |
| 10 Fail-closed | `NO_CHALLENGER_QUALIFIES` valid |
| 11 KA | holm/bootstrap/cdf vectors |
| 12 Tests | harness unit suite |
| 13 PIT | anchor eligibility |
| 14 Replay | bootstrap seed deterministic |
| 15 Budget | B=10000 cap |
| 16 Migration | `0136`–`0137` |
| 17 Evidence | N/A |
| 18 Dependencies | FORECAST-V2, DATASET-QUAL |
| 19 Risk | T1 |
| 20 DoD | all baselines executable |
| 21 Human | grid ratification |

### A.14 WP-EXECOPP-QUAL (DEE-532)

| # | Contract |
|---|----------|
| 1 Purpose | Joint exec-opp qualification + K/M gate |
| 2 Seams | forecast-v2 exec path, harness |
| 3 Files | `execopp-qualification/*`, km-convergence gate |
| 4 Formulas | energy-mc/v1; K/M §1.14 user spec |
| 5 Time | development anchors only for K/M |
| 6 Inputs | volume QUALIFIED, normalized 13-D |
| 7 Persistence | admission receipt |
| 8 Design | empirical-joint + marginal-independence baselines |
| 9 Forbidden | blockbootstrap name without contract |
| 10 Fail-closed | normalization degenerate |
| 11 KA | K/M selection deterministic |
| 12 Tests | admission + km gate |
| 13 PIT | dev only for km |
| 14 Replay | admission receipt digest |
| 15 Budget | §K/M compute caps |
| 16 Migration | none |
| 17 Evidence | N/A |
| 18 Dependencies | FORECAST-V2, VOLUME-QUAL, RESEARCH |
| 19 Risk | T1 |
| 20 DoD | receipt emitter |
| 21 Human | H3 K/M α |

### A.15 WP-PATTERN-RESEARCH (DEE-533)

| # | Contract |
|---|----------|
| 1 Purpose | Pattern/recurrence RESEARCH_ONLY substrate |
| 2 Seams | `mi-pattern` tables, new pattern registry |
| 3 Files | `lib/trader/mi/pattern-research/*` |
| 4 Formulas | v_tilde, a_tilde ablation defs (research) |
| 5 Time | PIT quantizer on state vector |
| 6 Inputs | feature snapshots |
| 7 Persistence | pattern definition + occurrence tables |
| 8 Design | no capital wiring |
| 9 Forbidden | modulo-9 signals; direct Decision authority |
| 10 Fail-closed | RESEARCH_ONLY guard |
| 11 KA | transition matrix row sums |
| 12 Tests | substrate unit |
| 13 PIT | quantizer uses ≤t |
| 14 Replay | pattern digest |
| 15 Budget | bounded registry |
| 16 Migration | `0130`–`0133` |
| 17 Evidence | N/A |
| 18 Dependencies | RESEARCH-HARNESS |
| 19 Risk | T2 |
| 20 DoD | pattern≠edge enforced |
| 21 Human | promotion gate future |

### A.16 WP-KNOWLEDGE-STATE (DEE-534)

| # | Contract |
|---|----------|
| 1 Purpose | Bounded knowledge checkpoint |
| 2 Seams | 0108 knowledge confidence, intelligence records |
| 3 Files | `lib/trader/intelligence/knowledge-state/*` |
| 4 Formulas | knowledge semantic digest SHA-256 |
| 5 Time | checkpoint at cycle boundary |
| 6 Inputs | model version, calibration snapshot |
| 7 Persistence | knowledge checkpoint table |
| 8 Design | separate from FHV hot state |
| 9 Forbidden | unbounded history in hot path |
| 10 Fail-closed | `KNOWLEDGE_CHECKPOINT_MISMATCH` |
| 11 KA | roundtrip digest |
| 12 Tests | checkpoint restore |
| 13 PIT | N/A |
| 14 Replay | digest match |
| 15 Budget | O(1) hot |
| 16 Migration | `0134`–`0135` |
| 17 Evidence | N/A |
| 18 Dependencies | FORECAST-V2 |
| 19 Risk | T2 |
| 20 DoD | replay deterministic |
| 21 Human | none |

### A.17 WP-CHALLENGER-TRIALS (DEE-535)

| # | Contract |
|---|----------|
| 1 Purpose | Research challengers for harness |
| 2 Seams | harness model registry |
| 3 Files | `lib/trader/research/challengers/*` |
| 4 Formulas | §4 MODEL_TRIAL_SPEC |
| 5 Time | fit development only |
| 6 Inputs | features, outcomes |
| 7 Persistence | model artifacts in package bytea |
| 8 Design | `rv-state-conditional-empirical-joint/v1` EXECUTOR_READY with epistemic bootstrap replicas; HAR research-only |
| 9 Forbidden | hidden lib defaults; terminal-only challenger as sole EXECUTOR_READY; redefining K as MC streams |
| 10 Fail-closed | UNIMPLEMENTED families skipped not invented |
| 11 KA | rv-state-joint synthetic coherence; K≠M property tests |
| 12 Tests | challenger integrates harness; marginal=terminal; epistemic replica digest tests |
| 13 PIT | fit boundary |
| 14 Replay | artifact digest |
| 15 Budget | O(1) score per anchor |
| 16 Migration | none |
| 17 Evidence | N/A |
| 18 Dependencies | RESEARCH-HARNESS, FEATURE-RV |
| 19 Risk | T2 |
| 20 DoD | ≥1 challenger EXECUTOR_READY |
| 21 Human | OG-SCI-PACKAGE selection |
