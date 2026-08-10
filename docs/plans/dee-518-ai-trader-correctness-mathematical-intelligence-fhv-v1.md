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
  nextAction: "Human plan approval (state.status -> approved) after F2 nested K/M convergence random-surface micro-closure review; then /implement starting WP-CANON"
provenance:
  createdFrom: chat
  gateDRatificationSha: 1f10d4eebce23f92dccb3d550e8dc10812d26a9e
  humanRatificationComment: "DEE-516 HUMAN ARCHITECT RATIFICATION — FINAL AI-TRADER GATE-D PACKAGE APPROVED (2026-08-09)"
  hpaCorrection: "HPA-1..HPA-7 applied (2026-08-09); prior commit 8182e97"
  purposeEpistemicGuardianClosure: "P1/P2/P3/E1/E2/N1/G1 applied (2026-08-10); prior commit 2bf582c"
  bootstrapRngSizingPolicyClosure: "B1/B2/B3/B4/B5 applied (2026-08-10); prior commit c3ce72c"
  scientificIdentityPreHoldoutClosure: "C1/C2/C3/C4/C5/C6/C7/C8 applied (2026-08-10); prior commit f5d0aeb"
  byteExactDigestClosure: "D1/D2/D3/D4/D5 applied (2026-08-10); prior commit 93542c5"
  e1E3FinalMicroClosure: "E1/E2/E3 applied (2026-08-10); prior commit 69bf603"
  f1KmConfigurationIdentityClosure: "F1 applied (2026-08-10); prior commit 68d0482"
  f2NestedKmConvergenceSurfaceClosure: "F2 applied (2026-08-10); prior commit 6eaebfb"
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

### 1.4 Historical partitions (verified `fhv-dataset-manifest.ts`; C5 sub-partition refinement)

**Manifest v1 field `walkForward`** remains `[2023-01-01, 2025-01-01)` on main for receipt compatibility. **DEE-518 scientific gates** subdivide that interval into two independent pre-holdout qualification surfaces (logical sub-partitions; WP-DATASET-QUAL receipts MUST bind each explicitly):

| Partition | Interval (UTC, half-open) | Authority |
|-----------|---------------------------|-----------|
| **DEVELOPMENT** | `[2020-01-01, 2023-01-01)` | Fit, bootstrap refits, feature normalization, preregistered hyperparameters, target-grid methodology, model construction only |
| **WF_PREDICTIVE** | `[2023-01-01, 2024-01-01)` | **STAGE-A only** — predictive qualification / package selection |
| **WF_ECONOMIC** | `[2024-01-01, 2025-01-01)` | **STAGE-B only** — realized economic-utility qualification after all pre-economic Human receipts |
| **BLIND_HOLDOUT** | `[2025-01-01, 2026-01-01)` | `SEALED_NOT_ACCESSED` — single shot (DEE-541) |

**Independence rules (C5):**

- WF_PREDICTIVE MUST NOT be used as the independent STAGE-B economic PASS surface.
- WF_ECONOMIC MUST NOT be used for package selection / predictive model choice.
- After any WF_ECONOMIC evidence is computed or revealed: no package, Decision-policy, sizing, Guardian/exit, or acceptance-threshold retuning. Violation invalidates STAGE-B; holdout stays sealed.
- **`HUMAN_FHV_EXECUTABLE_POLICY_V1`** and **`HUMAN_ECONOMIC_UTILITY_ACCEPTANCE_V1`** MUST both be sealed **before** WF_ECONOMIC economic evidence is computed, materialized, displayed, or used for PASS/FAIL.

**Canon check:** No ratified document forbids this subdivision. `FHV_DATASET_PARTITIONS_V1.walkForward` is the union `WF_PREDICTIVE ∪ WF_ECONOMIC`; sub-partitions are additive scientific receipts, not a manifest override.

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
- Per-replica artifact: `<= 65536` bytes
- Per-package replica-artifact byte sum: `K_max * 65536` where `K_max = 50` → **`3_276_800` bytes** (trigger-enforced; no unexplained extra slots)
- Decision eval: O(K) memory, `<= 1e5` ops/candidate
- Scoring: O(S·d), `<= 1e5` ops/resolution, no O(S²)
- Hot/checkpoint: O(1) in forecast history count

### 1.13 Evidence strategy

Pre-merge: engineering evidence via unit/integration tests + storage-scale test receipts. Post-merge: OG-* gates produce operational/scientific receipts. Prior failed Control Replay economic evidence quarantined as non-authoritative where Gate-A defects applied.

### 1.14 Rollback / versioning

Additive V2 schema only; V1 quarantine. Feature versions pinned (`feature-engine/rv/v2`, `quantizeScale8HalfUp/v1`, `waia-cbrng/sha256-ctr/v1`, `stationary-bootstrap/v1`, `energy-mc/v1`, `cdf-erf-cody715/v1`, `student-t5-cdf-betainc/v1`). Rollback = revert PR; V2 tables orphaned but append-only.

### 1.15 Post-merge gate graph

```
Implementation merge (DEE-518)
  → OG-HOST-QUAL (DEE-536)
  → OG-DATA-RECEIPTS (DEE-537)
  → OG-CONTROL-REPLAY (DEE-538) [NOT blocked on scientific qualification]
  → OG-SCI-PACKAGE (DEE-539) — pre-holdout scientific stages (DEVELOPMENT / WF_PREDICTIVE / WF_ECONOMIC only; never 2025 holdout):
        STAGE-A PREDICTIVE_SKILL_PASS on WF_PREDICTIVE
          → freeze selected predictive package generation + content identity
          → freeze Decision policy / economic semantics version
        BLOCKING_PRE_HOLDOUT_POSITION_REASSESSMENT_INTEGRATION (§1.22; future separate integration under DEE-512 — NOT in DEE-518 PR)
          → if Forecast/Decision/executable semantics change: rerun DEVELOPMENT + WF_PREDICTIVE qualification
        HUMAN_FHV_EXECUTABLE_POLICY_V1 (Human receipt; §1.23–§1.25)
          → MUST occur after STAGE-A (+ Position Reassessment gate if applicable)
          → MUST occur BEFORE WF_ECONOMIC evidence computation
          → freeze complete FHV_EXECUTABLE_POLICY_V1 + executable_policy_digest
        HUMAN_ECONOMIC_UTILITY_ACCEPTANCE_V1
          → MUST occur BEFORE WF_ECONOMIC evidence computation
        STAGE-B LOCKED WF_ECONOMIC ECONOMIC-UTILITY QUALIFICATION
          → execute FHV_EXECUTABLE_POLICY_V1 (§1.24) on WF_ECONOMIC only
          → ECONOMIC_UTILITY_PASS  OR  NO_ECONOMIC_EDGE_QUALIFIES
        ONLY on ECONOMIC_UTILITY_PASS:
          → FROZEN_SELECTED_PACKAGE_READY (binds executable_policy_digest)
  → OG-HOLDOUT-AUTH (DEE-540) [requires CONTROL_REPLAY=PASS AND FROZEN_SELECTED_PACKAGE_READY]
  → OG-FHV (DEE-541) [executes IDENTICAL executable_policy_digest on BLIND_HOLDOUT; partition/receipt only may differ]
```

**P1 invariant:** Predictive PnL MUST NOT be the Forecast model-selection score. Economic utility is a separate downstream qualification on **WF_ECONOMIC** of an already-frozen predictive package + already-frozen Decision policy + already-frozen **executable policy** (§1.24). No parameter/model/policy/sizing/Guardian retuning after seeing WF_ECONOMIC results. `NO_ECONOMIC_EDGE_QUALIFIES` preserves `BLIND_HOLDOUT = SEALED_NOT_ACCESSED`.

**B5 invariant:** WF_ECONOMIC STAGE-B and blind FHV (DEE-541) MUST bind the **same** `executable_policy_digest`. Any post-STAGE-B executable-policy mutation invalidates STAGE-B PASS and requires WF_ECONOMIC requalification while holdout remains sealed.

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
- Epistemic replica + canonical pool + identity DAG + byte-exact nested digests (§2.4.0–§2.4.2, §2.10–§2.11, §4.1) encoded
- `stationary-bootstrap/v1` + byte-exact `WAIA_RANDOM_BLOCK_V1` (§2.4.0, §2.6) encoded
- Sizing/allocation authority + executable-policy identity documented (§1.23–§1.24)
- FHV-v1 Guardian disposition (§1.22) documented; mature Position Reassessment NOT claimed as FHV-v1 PASS
- Canon/docs/ADRs updated (WP-CANON)
- Plan `state.status: integration-ready`
- PR opened to `main` with governance preflight PASS
- Post-merge gates documented open (DEE-536…541); `FROZEN_SELECTED_PACKAGE_READY` requires ECONOMIC_UTILITY_PASS

### 1.19 Pre-holdout economic-utility qualification (P1)

**Authority sources inspected:** ADR-0010 Strategy Validation Gate; Target Architecture §22; Gate-D ratification. **Finding:** No Human-ratified numeric acceptance threshold for first-program walk-forward economic utility exists. ADR-0010: “quantitative thresholds are set later by the operator and recorded” / “evidence class, not numeric gates.”

**Frozen three-stage gate (inside DEE-539 OG-SCI-PACKAGE):**

1. **PREDICTIVE_SKILL_PASS on WF_PREDICTIVE** — proper predictive scoring vs mandatory baselines (WP-RESEARCH-HARNESS / WP-EXECOPP-QUAL). Output: freeze the **already-evaluated selected candidate** tuple `(replica_root_family_identity_digest, predictive_package_generation_identity_digest, predictive_package_content_digest, model_transform_version, K_config, M_config, alpha_epi_config, decision_policy_version, economic_semantics_version)` — digests computed **before** H3 from exact nested stochastic family + `(K_config_dec, M_config_dec, alpha_epi_config_scale8)` configuration binding (§2.10 F1+F2).
2. **`BLOCKING_PRE_HOLDOUT_POSITION_REASSESSMENT_INTEGRATION`** — future separate integration boundary (§1.22); if it changes Forecast/Decision/executable semantics, rerun DEVELOPMENT + WF_PREDICTIVE qualification before proceeding.
3. **`HUMAN_FHV_EXECUTABLE_POLICY_V1`** — Human receipt **after STAGE-A** (+ Position Reassessment gate when applicable) and **before WF_ECONOMIC evidence** (§1.23–§1.25).
4. **`HUMAN_ECONOMIC_UTILITY_ACCEPTANCE_V1`** — Human numeric rule sealed **before WF_ECONOMIC evidence** (not merely before PASS marker).
5. **LOCKED WF_ECONOMIC ECONOMIC-UTILITY QUALIFICATION** — apply the **already-frozen** package + Decision policy + **`FHV_EXECUTABLE_POLICY_V1`** on **WF_ECONOMIC only** (§1.4). **No retuning.**

**Exact evidence produced (executor-fixed; not a menu):**

| Evidence artifact | Content |
|-------------------|---------|
| `economic_utility_receipt.v1` | `predictive_package_generation_identity_digest`, `predictive_package_content_digest`, `executable_policy_digest`, `decision_policy_version`, `sizing_policy_version`, **WF_ECONOMIC** partition digest, cost_model_version, C0, K/M notional grid **reporting-only** |
| `cash_null_comparison.v1` | path PnL/equity under selected policy vs pure-cash null (no trades) under identical costs/clock |
| `abstention_summary.v1` | counts/rates of `DECISION_NON_ACTIONABLE` / NO_TRADE |
| `execution_friction_summary.v1` | fees, spread, impact, residual inventory events, unresolved residual fails, Guardian early-exit counts |
| `economic_utility_terminal_state` | `ECONOMIC_UTILITY_PASS` **or** `NO_ECONOMIC_EDGE_QUALIFIES` |

**Null/cash comparison semantics:** Primary comparison is selected-policy net equity path vs cash-null path on the same **WF_ECONOMIC** clock and cost model under **`FHV_EXECUTABLE_POLICY_V1`**. Predictive score / log-score MUST NOT appear as the economic acceptance statistic.

**No-retuning rule:** After STAGE-A freeze, any change to package parameters, Decision policy, **`executable_policy_digest`**, cost model, participation, sizing/allocation, Guardian/ATR configuration, Position Reassessment semantics, or liquidation doctrine voids the economic-utility run and requires a new STAGE-A freeze identity.

**Terminal states:**

- `ECONOMIC_UTILITY_PASS` → may emit `FROZEN_SELECTED_PACKAGE_READY` only after Human economic-utility ratification (§ below). Receipt MUST bind `executable_policy_digest`.
- `NO_ECONOMIC_EDGE_QUALIFIES` → durable fail; **MUST** keep `BLIND_HOLDOUT = SEALED_NOT_ACCESSED`; holdout remains closed.

**Human scientific gates (numeric acceptance):**

| Gate | Blocks |
|------|--------|
| `HUMAN_FHV_EXECUTABLE_POLICY_V1` | STAGE-B start (§1.23–§1.24) |
| `HUMAN_ECONOMIC_UTILITY_ACCEPTANCE_V1` | STAGE-B `ECONOMIC_UTILITY_PASS` numeric rule |

Because ADR-0010 leaves quantitative thresholds operator-set, the numeric PASS rule (e.g. minimum net expectancy, max drawdown, min trade count) is **`HUMAN_ECONOMIC_UTILITY_ACCEPTANCE_V1`** — recorded by Human before STAGE-B may emit PASS. Executor produces evidence only; executor MUST NOT invent the threshold.

### 1.20 Strategy authority disposition (P2)

**V2 authority rule (ONE design):**

```
Knowledge / state
  → Forecast V2 owns predictive distribution
  → Strategy may provide deterministic tactical / action-candidate semantics only
  → Decision V2 owns economic valuation / actionability
```

**Compatibility disposition for legacy fields (ONE choice):**

`StrategySignal.confidence`, `StrategySignal.expectedEdge`, and **`StrategySignal.maxRisk`** are **quarantined non-authoritative legacy diagnostics** on the V2 capital path.

- Retained on the type for structural compatibility with existing strategy modules / telemetry.
- Renamed in Decision V2 consumers to `legacyDiagnosticConfidence` / `legacyDiagnosticExpectedEdge` / `legacyDiagnosticMaxRisk` when read for logging only.
- **V2 Decision path MUST NOT** derive Forecast probability, EV, conservative EV range, or capital actionability from these fields.
- **V2 sizing path MUST NOT** treat `StrategySignal.maxRisk` as an independent capital-sizing authority. Current main `computeStopBasedQuantity()` clamps by `signal.maxRisk` — this seam is **deprecated on V2** and replaced by the frozen sizing policy in `FHV_EXECUTABLE_POLICY_V1` (§1.23).
- Gross/net EV for V2 comes solely from Forecast-owned sealed samples + WP-DECISION-ECON payoff functionals `Π_base` / `Π_lower`.

**Regression invariant:** For otherwise identical Forecast V2 / market state / action candidate, mutating legacy strategy `confidence`, `expectedEdge`, or `maxRisk` MUST NOT alter V2 Forecast probabilities, V2 Decision EV range, V2 Decision actionability, or V2 desired-size proposal.

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

**TWO SEPARATE CONTRACTS (must remain distinct — B5):**

| Contract | Version id | Role |
|----------|------------|------|
| **A. Scientific valuation** | `SCIENTIFIC_VALUATION_CONTRACT_V1` | Precommitted horizon target/payoff evaluation for Forecast/Decision **scientific scoring**; entry at N+1..N+3; exit first eligible slice at `t+h+1m`; continue until flat; residual fail-closed; no hindsight. May remain as a separately scored counterfactual valuation contract. **Must not be altered by runtime Guardian.** |
| **B. FHV executable policy** | `FHV_EXECUTABLE_POLICY_V1` | Actual policy producing the **WF_ECONOMIC** economic-equity path and the **identical** blind FHV path (DEE-541). Includes sizing, Portfolio, Risk, cost, participation, entry, Guardian/ATR when enabled, mandatory post-horizon liquidation, kill/close-only behavior. **Must not retroactively rewrite scientific target A or create hindsight in A.** |

**FHV-v1 disposition (chosen):** Mature Position Reassessment is **intentionally beyond the DEE-518 implementation PR** but is **NOT post-holdout**.

FHV-v1 validates only the **narrow Guardian policy** as a **fully specified subset of `FHV_EXECUTABLE_POLICY_V1`** — never “optional” once policy is frozen:

`permission/max-hold/close-only/stop-trading + exact enabled/disabled ATR SL/TP/trailing (when enabled per Human receipt) + inventory-capped partials + read-only Exit Intelligence`.

**Exit priority ordering (frozen inside `executable_policy_digest`):**

1. Safety/kill exits (`TRIPPED` fold → revoke allowances → cancel pending entries → CLOSE_ONLY → FLATTEN → HALT)
2. Guardian exits (max-hold, permission, strategy-disallowed, ATR SL/TP/trailing when enabled)
3. Mandatory post-horizon liquidation (when position still open and no higher-priority exit fired)

**Early Guardian exit semantics:** If Guardian causes an early actual exit before horizon `h`, the **realized economic path** uses that actual exit timestamp/price. The **scientific Forecast target** and `SCIENTIFIC_VALUATION_CONTRACT_V1` resolution at `h` remain separately resolved — do **not** rewrite the Forecast target or scientific valuation evidence.

**BLOCKING PRE-HOLDOUT integration gate (C7 — replaces post-DEE-541 carry-forward):**

`BLOCKING_PRE_HOLDOUT_POSITION_REASSESSMENT_INTEGRATION`

- **Scope:** Future **separate integration boundary under DEE-512** (Linear issue NOT created in this session). Remains **outside DEE-518 PR** for reviewability/dependency reasons.
- **Purpose:** Implement and qualify mature open-position reassessment **before** the 2025 blind holdout is opened, so DEE-541 validates the actual intended first-live executable policy.
- **Required gate order:**

```
DEE-518 implementation merge
  → engineering/host/data/control gates as applicable
  → STAGE-A predictive work on WF_PREDICTIVE
  → BLOCKING_PRE_HOLDOUT_POSITION_REASSESSMENT_INTEGRATION
  → if Forecast/Decision/executable semantics changed:
        rerun DEVELOPMENT + WF_PREDICTIVE qualification
  → freeze final predictive/Decision identity (§2.10)
  → HUMAN_FHV_EXECUTABLE_POLICY_V1
  → HUMAN_ECONOMIC_UTILITY_ACCEPTANCE_V1
  → STAGE-B on WF_ECONOMIC
  → ECONOMIC_UTILITY_PASS
  → FROZEN_SELECTED_PACKAGE_READY
  → DEE-540 one-shot Human holdout authorization
  → DEE-541 blind 2025
  → only then any live-capital readiness discussion
```

- **Must ultimately close (architecture-review required before implementation):** open-position reevaluation every qualified cycle; original thesis vs current state; structural/regime invalidation; current predictive evidence; remaining expected payoff HOLD vs EXIT where scientifically supported; RR decay; time-in-trade; data/event deterioration; exposure/opportunity cost; HOLD/EXIT_PARTIAL/EXIT_FULL authority; Risk/kill dominance; stop-never-widens; exact evidence/reason records; no hindsight; Decision-payoff/executable-policy consistency (§1.25).
- **If Position Reassessment requires expanded Forecast path authority:** that work MUST complete and requalify on DEVELOPMENT/WF_PREDICTIVE **before** 2025 can be opened.
- **Forbidden disposition:** “after DEE-541 and before live” — **removed**. Post-holdout Position Reassessment would invalidate blind evidence unless treated as a **new product version** requiring a **new independent sealed holdout** before capital promotion.

**WP-AUTHORITY scope for DEE-518:** enforce Decision→Risk→Execution + kill fold; document Guardian FHV-v1 narrow policy; **do not** implement mature Position Reassessment inside DEE-518.

### 1.23 Action sizing / allocation authority (B4)

**Purpose blocker closed:** STAGE-B cannot freeze only `decision_policy_version` without defining how an ACTIONABLE Decision becomes desired notional / quantity.

**Verified current-main seams (baseline `1f10d4ee`):**

| Seam | Current behavior |
|------|------------------|
| `lib/trader/portfolio/stop-based-sizing.ts` | `computeStopBasedQuantity()` — stop-distance-based qty capped by portfolio limits; **also** clamps by `signal.maxRisk / entryPrice` |
| `lib/trader/portfolio/idhps-portfolio-sizing.ts` | Portfolio allocation helpers |
| `lib/trader/research/htr-initial-portfolio-contract.ts` | `HTR_DEFAULT_PORTFOLIO_SIZING_LIMITS`: `maxRiskPerTradePct="0.10"`, `maxPortfolioRiskPct="0.50"`, `maxConcurrentPositions=10`, `maxNotional="100000.00"` |
| `lib/trader/portfolio/portfolio-run-config.types.ts` | `defaultStopDistancePct="0.02"`, `minOrderQty="0.00001"` |
| `lib/trader/research/htr-initial-portfolio-constants.ts` | `C0 = startingBalanceUsdt = "100000.00"` (also §1.6) |
| `lib/trader/observability/fhv-full-historical-engine.ts` | uses `defaultQuantity: "0.01"` (research default; **not** ratified as FHV executable policy) |
| `lib/trader/risk/limits/defaults.ts` | `maxRiskPerTradePct: "0.01"` (generic default; **differs** from HTR contract — not authoritative for FHV without Human receipt) |

**Frozen authority ordering (ONE chain):**

```
Forecast
  → Decision action candidate + economic valuation (EV range / actionability)
  → deterministic desired-size / allocation proposal (sizing policy)
  → Portfolio constraints (limits, concurrency, notional caps)
  → Risk downward-only clamp / veto (economics-blind)
  → Execution
```

**Invariants:**

- Risk MUST NOT improve/increase a proposal — only clamp/veto downward.
- Strategy MUST NOT own an independent capital-sizing authority on V2 unless Human explicitly ratifies a bounded **downward tactical cap** inside `FHV_EXECUTABLE_POLICY_V1` (default disposition: **quarantined legacy diagnostic**, §1.20).
- K/M notional grid in WP-EXECOPP-QUAL (`scale grid {0.01,0.05,0.10,0.25,0.50}·C0`) is **SCIENTIFIC SENSITIVITY TEST authority only** and MUST NOT silently become production/FHV sizing.

**Partial literals already on main (inform Human receipt; not sufficient alone for STAGE-B):**

| Parameter | Current-main literal | Source |
|-----------|---------------------|--------|
| `C0` | `"100000.00"` | `htr-initial-portfolio-constants.ts` / §1.6 |
| `maxRiskPerTradePct` | `"0.10"` | `HTR_DEFAULT_PORTFOLIO_SIZING_LIMITS` |
| `maxPortfolioRiskPct` | `"0.50"` | same |
| `maxConcurrentPositions` | `10` | same |
| `maxNotional` | `"100000.00"` | same |
| `defaultStopDistancePct` | `"0.02"` | `DEFAULT_PORTFOLIO_RUN_CONFIG` |
| `minOrderQty` | `"0.00001"` | same |

**Parameters NOT ratified as first-program FHV executable policy (Human MUST freeze — executor MUST NOT invent):**

- `sizing_policy_version` (e.g. stop-based-sizing rule identity)
- `defaultQuantity` / desired-size rule beyond partial code defaults
- max risk per trade binding when HTR vs generic defaults conflict
- multi-symbol candidate arbitration when BTC and ETH are simultaneously ACTIONABLE
- cash insufficiency / below-min-qty behavior on V2 path
- quantity rounding / stepping semantics
- explicit `StrategySignal.maxRisk` V2 disposition confirmation
- Guardian `maxHoldBars`, ATR exit-engine enabled state and all ATR multiples (see §1.24)

**Human gate `HUMAN_FHV_EXECUTABLE_POLICY_V1` (mandatory):**

- **When:** after STAGE-A predictive package selection; **before** STAGE-B economic-utility execution; **before** any holdout authorization.
- **Must freeze at minimum:** `sizing_policy_version`, `C0`, desired-size rule, max risk per trade, max portfolio risk, max notional, max concurrent positions, min order quantity, default/fallback stop-distance semantics, candidate arbitration, cash insufficiency behavior, rounding, legacy `StrategySignal.maxRisk` disposition, and all Guardian/ATR fields in §1.24 when not already separately ratified.
- **Receipt output:** `executable_policy_digest` (§1.24) bound into `economic_utility_receipt.v1` and `FROZEN_SELECTED_PACKAGE_READY`.
- **No parameter may be selected after STAGE-B results.**

### 1.24 FHV executable policy identity (B5)

**Before STAGE-B**, seal ONE complete `executable_policy_digest` over the full runtime-affecting configuration:

| Component | Included in digest |
|-----------|-------------------|
| Predictive package | `predictive_package_generation_identity_digest`, `predictive_package_content_digest` |
| Decision / economic semantics | `decision_policy_version`, `economic_semantics_version` |
| Sizing / allocation | `sizing_policy_version` + all §1.23 Human-frozen sizing fields |
| Portfolio | portfolio schema version + limits + run config digests |
| Risk | risk limits version + kill/flatten semantics |
| Cost model | fee/spread/impact bps versions |
| Participation model | participation cap semantics |
| Entry mechanics | N+1..N+3 closed-bar entry doctrine |
| Scientific valuation (counterfactual) | `SCIENTIFIC_VALUATION_CONTRACT_V1` version (horizon liquidation for scoring) |
| Mandatory horizon liquidation | horizon-liquidation version for executable path |
| Guardian | **exact** `enabled` boolean; `maxHoldBars`; bar interval |
| ATR exit engine | **exact** `enabled` boolean; if enabled: `atrPeriod`, stop-loss ATR multiple, take-profit ATR multiple, trailing activation ATR multiple, trailing distance ATR multiple |
| Inventory partial-exit rules | partial-exit cap semantics |
| Close-only / STOP / kill behavior | kill-fold version |
| Exit priority ordering | §1.22 ordering digest |

**No `optional` field** is permitted in the frozen selected policy — every runtime-affecting switch is exact `enabled`/`disabled` + values.

**Current-main defaults (reference only — Human receipt required; executor MUST NOT select):**

| Field | Current-main default | Source |
|-------|---------------------|--------|
| Guardian.enabled | `true` | `DEFAULT_GUARDIAN_RUN_CONFIG` |
| Guardian.maxHoldBars | `0` (disabled) | same |
| ExitRunConfig.enabled | `true` | `DEFAULT_EXIT_RUN_CONFIG` |
| atrPeriod | `14` | same |
| stopLossAtrMultiple | `"2"` | same |
| takeProfitAtrMultiple | `"3"` | same |
| trailingActivationAtrMultiple | `"1.5"` | same |
| trailingDistanceAtrMultiple | `"1"` | same |

**Execution binding:**

- STAGE-B (DEE-539) executes **`FHV_EXECUTABLE_POLICY_V1`** on **WF_ECONOMIC**.
- DEE-541 executes the **IDENTICAL** `executable_policy_digest` on BLIND_HOLDOUT; only dataset partition / authorization receipt may differ.
- Post-STAGE-B mutation of any digested component invalidates STAGE-B PASS; holdout remains sealed until WF_ECONOMIC requalification.

**Predictive/scientific truth vs realized economic utility remain separately measurable:**

- Scientific scoring uses `SCIENTIFIC_VALUATION_CONTRACT_V1` at horizon `h`.
- Realized equity path uses `FHV_EXECUTABLE_POLICY_V1` including any early Guardian exits.

### 1.25 Decision economic payoff vs executable policy (C6)

**Invariant:** `DECISION_ECONOMIC_PAYOFF_POLICY` MUST represent the **normal executable policy** whose capital action Decision is authorizing. Emergency fail-safe / kill / CLOSE_ONLY behavior may remain downstream safety overrides. **Normal planned economic exits cannot materially alter payoff while remaining invisible to Decision economics.**

**13-D Execution Opportunity vector (§2.3) — predictive path authority audit:**

`[R_1,R_2,R_3,R_h,R_{h+1},R_{h+2},R_{h+3}, V_1..V_3, V_{h+1}..V_{h+3}]` — sparse closed-bar returns at fixed offsets only.

| Normal exit rule | Sufficient in current 13-D? |
|------------------|----------------------------|
| Mandatory post-horizon liquidation at `t+h+1m` | **Yes** (uses `R_h`, post-h slices) |
| maxHoldBars (bar-count hold) | **Partial** — requires bars-held state, not intrabar path |
| ATR stop-loss hit timing | **No** — requires intrahorizon price path / ATR series |
| Take-profit hit timing | **No** |
| Trailing activation + peak evolution | **No** |
| Intrahour max/min path for partial exits | **No** |
| Mature Position Reassessment remaining-payoff | **No** — requires expanded path/state authority |

**Explicit finding:** The current 13-D sparse vector **cannot** reproduce arbitrary intrahorizon ATR/trailing/maxHold economics with PIT predictive authority. Do **not** assume it can.

**Two retained contracts (unchanged labels):**

| Contract | Role in C6 |
|----------|------------|
| `SCIENTIFIC_VALUATION_CONTRACT_V1` | Proper Forecast/Decision **scoring** at committed horizon; may remain counterfactual valuation |
| `FHV_EXECUTABLE_POLICY_V1` / `DECISION_ECONOMIC_PAYOFF_POLICY` | Must align for **actionability** and STAGE-B economic qualification |

**Before final executable-policy qualification, exactly one path must become true:**

| Path | Requirement |
|------|-------------|
| **A. Substrate extension** | Extend predictive/Decision substrate so normal planned exit rules in the frozen executable policy can be evaluated with sufficient PIT authority; rerun DEVELOPMENT + WF_PREDICTIVE; may be required by `BLOCKING_PRE_HOLDOUT_POSITION_REASSESSMENT_INTEGRATION` |
| **B. Policy disable (interim only)** | Disable normal exit rules not representable in `DECISION_ECONOMIC_PAYOFF_POLICY` (ATR/maxHold/trailing/mature reassessment), leaving only payoff-representable rules + emergency safety overrides |

**Human disposition (not executor-chosen):** `HUMAN_FHV_EXECUTABLE_POLICY_V1` MUST record which path applies and MUST NOT silently enable normal Guardian exits whose payoff is not represented in Decision economics. Permanent option B is **not** the final product target for a working Trader; it is an interim scientific qualification mode only unless Human explicitly ratifies narrow-Guardian as the first-live policy (which then requires Position Reassessment later to be a **new product version + new holdout**).

**WP-DECISION-ECON rule:** `DECISION_ACTIONABLE ⇔ EV_lower > 0` uses **`DECISION_ECONOMIC_PAYOFF_POLICY`** aligned with the same executable policy whose equity path STAGE-B measures — not a divergent scientific-only payoff unless that divergence is explicitly scored separately and does not authorize capital.

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

`DECISION_ACTIONABLE ⇔ EV_lower > 0` + upstream data/calibration/scientific-admission gates. **No Risk allowance term. No StrategySignal.confidence/expectedEdge/maxRisk term.**

#### 2.4.0 `stationary-bootstrap/v1` (B1 — frozen Politis-Romano semantics)

**Contract version:** `stationary-bootstrap/v1`

**Input source corpus:** `D = [d_0, ..., d_(n-1)]` in canonical chronological source order (§2.4.2 SOURCE corpus rules).

**Output replica:** `D_k = [d_(I_0), ..., d_(I_(n-1))]` with **EXACTLY** `n` resample positions (same length as source; sampling with replacement).

**Expected block length (integer-exact — C3 applies to all bootstrap uses):**

`L = smallest positive integer such that L^3 >= n`

Equivalently `L = ceil(n^(1/3))` **only when computed by integer arithmetic** — e.g. scan `L=1,2,3,...` until `L^3 >= n`. **Forbidden:** floating `Math.cbrt`, `n^(1/3)` approximations, or `ceil` on non-rational float intermediates for authority-critical block length.

**Exact restart probability:** `p = 1/L` — implemented **without floating Bernoulli ambiguity**:

For each output position `j > 0`:

`restart_j = (UNBIASED_INT(L) == 0)` using domain `EPIBOOT1` (§2.6).

**Algorithm (deterministic given root + ordinals):**

1. `I_0 = UNBIASED_INT(n)` at `resample_position_ordinal = 0`, `draw_u32 = 0`.
2. For `j = 1 .. n-1`:
   - draw exact restart decision: `restart_j = (UNBIASED_INT(L) == 0)` at `resample_position_ordinal = j`, `draw_u32 = 1`;
   - if `restart_j`: `I_j = UNBIASED_INT(n)` at same `j`, `draw_u32 = 0`;
   - otherwise: `I_j = (I_(j-1) + 1) mod n` (circular continuation).
3. Preserve output sequence order by `resample_position_ordinal = j`; emit `D_k[j] = D[I_j]`.

This yields circular stationary blocks with geometric block lengths (Politis-Romano stationary bootstrap).

**Random addressing (no mutable RNG cursor; no executor-selected implementation):**

| Semantic draw | DOMAIN | replica_u32 | sample_u32 | draw_u32 | retry_u32 |
|---------------|--------|-------------|------------|----------|-----------|
| Initial source index `I_0` | `EPIBOOT1` | `k` | `0` | `0` | rejection retry |
| Restart Bernoulli at `j>0` | `EPIBOOT1` | `k` | `j` | `1` | rejection retry |
| Restarted source index `I_j` | `EPIBOOT1` | `k` | `j` | `0` | rejection retry |

**Known-answer tests (mandatory):**

| Test | Expected |
|------|----------|
| `L = 1` when `n = 1` | single-element corpus |
| Integer L at cube boundaries | `n=8→L=2`, `n=9→L=3`, `n=27→L=3`, `n=28→L=4` |
| No restart path | deterministic circular continuation `(I_(j-1)+1) mod n` |
| Wrap | source index wraps `n-1 → 0` under continuation |
| Replacement legality | repeated source anchors in `D_k` are **valid** bootstrap multiplicity |
| Same `(source, root, replica)` | identical index vector `[I_0..I_(n-1)]` |
| Different replica root | independently addressed index vector |

**Forbidden:** floating `p = 1/L` Bernoulli; variable output length; mutable PRNG cursor; alternative stationary-bootstrap implementations.

#### 2.4.1 What K means vs what M means (E1 — P0)

| Symbol | Meaning (Gate-D F2 recovered; must not be redefined) |
|--------|------------------------------------------------------|
| **K** | Number of **epistemic model replicas**. Replica `k` is a **DEVELOPMENT-only deterministic stationary-bootstrap refit** of the forecast model — **not** a separate Monte Carlo sample stream from one fitted F. Variation across `{mu_k}` is epistemic model uncertainty. |
| **M** | Number of **aleatoric draws** from replica `k`'s predictive distribution `F_t^(k)` at issuance. Changing M reduces Monte Carlo error in `mu_k`; it does **not** redefine epistemic dispersion. |
| **S** | `S = K·M` total ephemeral samples for Decision/scoring (never persisted as rows). |
| **α_epi** | First-program configured value `0.10` (`alpha_epi_config_scale8` in `pkg-gen-id/v2`). **H3 Human ratification** is required before **capital eligibility** (§6) — not before constructing/evaluating a candidate package identity. |

**Replica construction (all EXECUTOR_READY packages, including §4.1):**

1. Let `D` = canonical DEVELOPMENT **SOURCE** corpus for `(symbol,h)` (§2.4.2) — unique source anchors required **before** bootstrap.
2. Compute **`replica_root_family_identity_digest`** per **§2.10** (`replica-root-family/v1`) — common to all K/M cells in the same `(symbol,h,model/data)` qualification family.
3. For each `k ∈ {0..K-1}` where `K = K_config_dec` (nested prefix of `K_max = 50`; **F2**):
   - `bootstrap_root_k = SHA256( bootstrap_root_prefix_16 ‖ replica_root_family_identity_digest_32 ‖ uint32_be(k) )` → **exactly 32 bytes** (§2.6, §2.10). Uses **replica-root family** identity — **not** candidate `pkg-gen-id/v2`; **never** content digest; **identical for all K/M cells** sharing the family.
   - Draw **`stationary-bootstrap/v1`** resample `D_k` of length `n = |D|` using `WAIA_RANDOM_BLOCK_V1` domain **`EPIBOOT1`** and `bootstrap_root_k`.
   - **Refit** model parameters on bootstrap **multiset** `D_k` only (for §4.1: type-7 tertile edges + state-conditional pools on `D_k` preserving bootstrap multiplicity).
   - Seal replica artifact `A_k` (edges, pool digests, counts, `bootstrap_root_k`, `L_block`, `model_transform_version`) with `model_artifact_digest`.
4. At issuance `t`, compute **`forecast_sampling_family_identity_digest`** (§2.10); `aleatoric_root_t = SHA256( aleatoric_root_prefix_16 ‖ forecast_sampling_family_identity_digest_32 )`. Replica `k` emits aleatoric samples using domain **`ALEDRAW1`** with ordinals `(k, m, draw)` — nested **draw prefix** `m ∈ {0..M-1}` of `M_max = 80` (**F2**); **separate** from bootstrap roots; **identical draw coordinates** for shared `(anchor,k,m)` across all M cells.
5. Decision consumes regenerated samples; never persists sample rows.

**Forbidden redefinition:** Using `(replica,sample,draw)` ordinals merely to draw from **one** shared fitted pool — that collapses K into Monte Carlo noise and **invalidates** `Q_0.10/0.50/0.90(mu_k)` as epistemic EV. **Forbidden:** uint32 `seed_k` as bootstrap root; long symbolic domain strings (`epi-bootstrap/v1`, `aleatoric-draw/v1`).

**Proof tests:**

- Holding K fixed, increasing M reduces within-replica variance of `mu_k` estimators (Monte Carlo error ↓).
- Holding M fixed, replicas with distinct `bootstrap_root_k` produce distinct sealed artifacts / edges when DEVELOPMENT has genuine dispersion.
- Identical `(D, replica_root_family_identity_digest, bootstrap roots)` regenerates identical replica digests and index vectors; changing `K_config`/`M_config`/`alpha_epi_config` MUST NOT redraw shared bootstrap/draw coordinates (**F2**).
- `stationary-bootstrap/v1` known-answer suite (§2.4.0) passes.

#### 2.4.2 Source corpus vs bootstrap multiset / canonical pools (E2 + B3)

Index sampling addresses a **canonical pool**, never filesystem/DB return order.

**SOURCE corpus identity (before bootstrap):**

`source_anchor_id = (venue, market, symbol, closed_bar_epoch_ms)`

| Rule | Frozen |
|------|--------|
| SOURCE ordering | Ascending `closed_bar_epoch_ms`; tie-break `bar_content_digest` lexicographic ascending |
| SOURCE duplicate anchors | Duplicate `source_anchor_id` in qualified DEVELOPMENT corpus → fail closed **`SOURCE_CORPUS_DUPLICATE_ANCHOR`** |
| Dataset integrity | Exact dataset/bar digest checks per WP-DATASET-QUAL receipt |

**Bootstrap replica multiset `D_k` (after `stationary-bootstrap/v1`):**

| Rule | Frozen |
|------|--------|
| Output length | Exactly `n = |D|` resample positions |
| Repeated source anchors inside `D_k` | **VALID** bootstrap multiplicity — MUST NOT fail |
| Bootstrap observation identity | `(replica_ordinal, resample_position_ordinal, source_anchor_id)` |
| Uniqueness inside replica | `resample_position_ordinal` unique within replica `k` |
| Pool construction for `rv-state-conditional-empirical-joint/v1` | State edges computed on bootstrap **multiset**; state-conditional empirical pools retain repeated observations according to bootstrap multiplicity |
| Canonical pool order (post state-filter) | Ascending `resample_position_ordinal` — **do NOT** re-sort by source timestamp after bootstrap |
| Distinct pool elements | Two occurrences of the same `source_anchor_id` at different resample positions are distinct legal empirical-pool elements |

For every `(symbol, h, state, replica_k)` pool:

| Field | Frozen rule |
|-------|-------------|
| DEVELOPMENT dataset digest/ref | Official FHV dataset qualification digest for DEVELOPMENT partition |
| Feature version | `feature-engine/rv/v2` |
| Target/outcome contract | 13-D EXECUTION_OPPORTUNITY + TERMINAL `R_h` marginal; outcome version `exec-opp-outcome/v1` |
| PIT eligibility | Anchor `t` eligible iff all required future closes/volumes for the 13-D vector exist and no look-ahead features used |
| State assignment version | `rv-state-tertile/v1` using replica `k`'s sealed edges |
| Outcome vector serialization | Fixed 13 × scale-8 HALF_UP canonical strings, UTF-8, `\n`-joined, for digest only |
| Pool length | `n_pool` after eligibility filter on bootstrap multiset `D_k` |
| Pool semantic digest | See **§2.11.4** `pool_semantic_digest` (exact byte stream — no placeholder fields) |
| Reconstruction | Qualified DEVELOPMENT SOURCE corpus + exact `bootstrap_root_k` + `stationary-bootstrap/v1` + feature/outcome/state versions → identical replica sequence / pools / digests |
| Verification before sampling | Recompute `pool_semantic_digest`; mismatch → `FORECAST_POOL_REPLAY_MISMATCH` fail closed |

**Persistence bound:** seal only compact replica artifacts (edges, digests, `bootstrap_root_k`, counts ≤64 KiB). Reconstruct pools on demand from DEVELOPMENT SOURCE corpus + bootstrap contract.

**Fail-closed codes:**

- `SOURCE_CORPUS_DUPLICATE_ANCHOR` — duplicate in SOURCE corpus (invalid)
- Bootstrap multiplicity — **never** an error

### 2.5 Quantizer `quantizeScale8HalfUp/v1` (FORECAST-ONLY)

Decode IEEE-754 binary64 to exact rational `(sign, mantissa, exponent2)`; value = `sign * mantissa * 2^exponent2`; multiply by `10^8`; integer HALF_UP (ties away from zero); emit fixed 8-decimal canonical string. Reject non-finite.

**Scope boundary:** `quantizeScale8HalfUp/v1` applies **only** to Forecast generative canonicalization and sealed distribution digests (§2.5.2). It does **not** replace existing Risk/execution arithmetic.

### 2.5.2 `distribution_semantic_digest` (D2 — Gate-D + quantizer amendment)

**Ratified encoding choice:** **B — `quantizeScale8HalfUp/v1` canonical scale-8 strings** (NOT raw IEEE-754 float64-BE). Gate-D Human ratification (2026-08-09) plus DEE-516/DEE-518 C1 quantizer amendment explicitly scopes the HALF_UP quantizer to Forecast generative seals and `distribution_semantic_digest`. Risk/execution paths remain separate (§2.5.1).

**Contract version:** `dist-sem-v1`

**Streaming SHA-256 procedure** (generate → hash → persist digest → discard ephemeral samples):

1. **Header block** — UTF-8 bytes, one field per line, `\n` terminated, no empty lines:

```
dist-sem-v1
forecast_generation_identity_digest_hex
predictive_package_content_digest_hex
K
M
S
component_layout_version
normalization_version_digest_hex
quantizer_version
target_role_id
```

- `forecast_generation_identity_digest_hex` = lowercase hex of 32-byte binary digest (64 ASCII chars; no `0x`).
- `predictive_package_content_digest_hex` = same hex rule.
- `K`, `M`, `S` = decimal ASCII integers (`S = K·M`).
- `component_layout_version` = `exec-opp-13d-v1` (frozen component order §2.3).
- `normalization_version_digest_hex` = hex of 32-byte digest (energy-mc normalization binding).
- `quantizer_version` = `quantizeScale8HalfUp/v1`.
- `target_role_id` = `EXECUTION_OPPORTUNITY` or `TERMINAL_RETURN` as applicable.

2. **Sample component stream** — nested loop order **fixed**:

```
for k = 0 .. K-1:
  for m = 0 .. M-1:
    for c = 0 .. 12:
      append UTF-8 bytes of quantizeScale8HalfUp/v1(sample[k,m,c])
      append 0x0A
```

Component index `c` maps to §2.3 order: `R_1,R_2,R_3,R_h,R_{h+1},R_{h+2},R_{h+3},V_1,V_2,V_3,V_{h+1},V_{h+2},V_{h+3}`.

3. **Finalize:** `distribution_semantic_digest = SHA256(header ‖ component_stream)`.

**Replay rule:** At consumption, regenerate samples with identical `(forecast_sampling_family_identity_digest, K_config, M_config, aleatoric roots)` bound to the sealed `forecast_generation_identity_digest` context → recompute stream → **`regenerated_distribution_semantic_digest == sealed_distribution_semantic_digest`** or fail closed **`FORECAST_DISTRIBUTION_REPLAY_MISMATCH`**. Aleatoric roots derive from `forecast_sampling_family_identity_digest` only (§2.10 F2) — not from candidate identity changes across K/M cells.

**Forbidden:** raw float64-BE in semantic stream; JSON serialization; executor choice between encodings; persisting per-sample rows.

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

### 2.6 RNG `WAIA_RANDOM_BLOCK_V1` (B2 — byte-exact)

**Sampler contract version:** `waia-cbrng/sha256-ctr/v1`

**64-byte preimage layout (exact offsets; all multi-byte integers big-endian):**

| Offset | Size | Field | Value |
|--------|------|-------|-------|
| 0 | 8 | `MAGIC` | ASCII `WAIACBR1` (exactly 8 bytes; no NUL padding) |
| 8 | 8 | `DOMAIN` | exact 8-byte ASCII domain constant (see table below) |
| 16 | 32 | `ROOT_SEED` | exactly 32 bytes — **never** a uint32 truncation |
| 48 | 4 | `replica_u32` | replica ordinal |
| 52 | 4 | `sample_u32` | sample / resample-position ordinal |
| 56 | 4 | `draw_u32` | draw semantic within `(replica, sample)` |
| 60 | 4 | `retry_u32` | rejection retry ordinal (starts at 0) |

`block = SHA256(preimage)` (32 bytes).

**Frozen 8-byte DOMAIN constants (first program — no runtime hashing/truncating of human-readable strings):**

| DOMAIN (8 bytes ASCII) | Use |
|------------------------|-----|
| `EPIBOOT1` | Epistemic stationary-bootstrap addressing (§2.4.0) |
| `ALEDRAW1` | Aleatoric model draw from replica pool at issuance |
| `SCORECRN1` | Scoring-stream CRN for `energy-mc/v1` / harness replica-selection dimension |
| `VALBOOT1` | Validation/significance stationary-bootstrap (§2.6.1) |

**Frozen 16-byte root prefixes (C1 — exact byte length + hex; known-answer tests MUST assert prefix bytes before SHA-256 vectors):**

| Prefix constant | ASCII (16 bytes) | Hex |
|-----------------|------------------|-----|
| `bootstrap_root_prefix_16` | `WAIAEPIBOOTROOT1` | `57414941455049424f4f54524f4f5431` |
| `aleatoric_root_prefix_16` | `WAIAALEDRAWROOT1` | `57414941414c4544524157524f4f5431` |
| `score_root_prefix_16` | `WAIASCOREROOT001` | `5741494153434f5245524f4f54303031` |
| `validation_bootstrap_root_prefix_16` | `WAIAVALBOOTROOT1` | `5741494156414c424f4f54524f4f5431` |

**32-byte root derivations (C2 — acyclic; binary digests decoded from SHA-256, not hex UTF-8):**

```
bootstrap_root_k = SHA256( bootstrap_root_prefix_16 ‖ replica_root_family_identity_digest_32 ‖ uint32_be(k) )

aleatoric_root_t = SHA256( aleatoric_root_prefix_16 ‖ forecast_sampling_family_identity_digest_32 )

score_root = SHA256( score_root_prefix_16 ‖ scoring_stream_identity_digest_32 )

validation_bootstrap_root = SHA256( validation_bootstrap_root_prefix_16 ‖ trial_identity_digest_32 )
```

See §2.10 for digest layers. **Forbidden cycles:** bootstrap roots MUST NOT use `predictive_package_content_digest` or candidate `K_config`/`M_config`; aleatoric roots MUST NOT use `forecast_content_digest`, `distribution_semantic_digest`, or candidate `K_config`/`M_config`.

**Ordinal field mappings:**

| Use | DOMAIN | replica_u32 | sample_u32 | draw_u32 | retry_u32 |
|-----|--------|-------------|------------|----------|-----------|
| Bootstrap initial/restart index | `EPIBOOT1` | `k` | `resample_position_ordinal` | `0` | rejection retry |
| Bootstrap restart Bernoulli | `EPIBOOT1` | `k` | `resample_position_ordinal` | `1` | rejection retry |
| Aleatoric pool index draw | `ALEDRAW1` | `k` | `m` | `draw` | rejection retry |
| Scoring stream CRN | `SCORECRN1` | `s` | `d` | `0` | **`0` exactly** (no rejection; one block → one uint53 numerator) |
| Validation bootstrap index/restart | `VALBOOT1` | `b` | `resample_position_ordinal` | `0` or `1` | rejection retry |

**`UNBIASED_INT(N)` for `[0, N)` (integer draws — bootstrap + pool indexing):**

Reject `N <= 0`.

```
limit = 2^64 - (2^64 mod N)
word = uint64_be(block[0:8])
if word >= limit:
  increment retry_u32 and redraw (new SHA256 block)
else:
  result = word mod N
```

No modulo bias. No mutable RNG cursor across calls — each semantic address is independent.

**Uniform `[0,1)` for scoring verification (§2.7 only):**

`u53 = (uint64_be(block[0:8]) >> 11) / 2^53` — used for scoring-stream semantic digest verification; **not** for bootstrap integer indexing.

**Forbidden:** passing uint32 `seed_k` where 32-byte `ROOT_SEED` is required; long symbolic domain names as executor input; executor-selected alternative RNG implementations; `seed mod 2^32` mutable PRNG for scientific admission.

### 2.6.1 Validation/significance bootstrap (C3)

Scientific admission p-values and significance bootstraps use the **same** `stationary-bootstrap/v1` transition algorithm (§2.4.0) with **separate** domain/root — not an executor-selected 32-bit PRNG.

| Field | Frozen value |
|-------|--------------|
| DOMAIN | `VALBOOT1` (8 bytes) |
| Root prefix | `WAIAVALBOOTROOT1` (16 bytes; hex `5741494156414c424f4f54524f4f5431`) |
| Root | `validation_bootstrap_root = SHA256( validation_bootstrap_root_prefix_16 ‖ trial_identity_digest_32 )` |
| Resample count | `B = 10000` |
| Resample ordinal | `replica_u32 = b` for `b ∈ {0..9999}` |
| Position ordinal | `sample_u32 = resample_position_ordinal j` |
| Draw semantics | `draw_u32 = 0` initial/restart source index; `draw_u32 = 1` restart decision |
| Retry | `retry_u32` for `UNBIASED_INT` rejection |
| Block length | `L = smallest positive integer with L^3 >= n` (integer-exact; §2.4.0) |

**Trial identity:** See **§2.11.5** `trial_identity_digest_32` (exact `trial-id/v2` serialization — not prose binding; Holm rank/index MUST NOT appear in trial identity).

**Forbidden:** `SHA256(trial_id) mod 2^32`; library default RNG; floating `cbrt` for L; any bootstrap implementation other than `stationary-bootstrap/v1` + `WAIA_RANDOM_BLOCK_V1`; executor-selected JSON for trial identity.

**Known-answer tests:** prefix byte vectors (§2.6); `n=1,8,9,27,28` L boundaries; identical `trial_identity_digest_32` ⇒ identical resample index vectors across `B` resamples; trial-id/v2 byte vectors (§2.11.5); permuting family comparison storage/evaluation order MUST NOT change any pairwise raw bootstrap p-value (§2.11.5).

### 2.7 Scoring streams (D3 — byte-exact CRN authority)

**Contract versions:** `score-base/v1`, `score-stream-id/v1`, `score-stream-sem/v1`

#### Step 1 — `score_base_seed` (model-independent)

Computed **before** any challenger/model identity. Canonical UTF-8 `\n`-terminated lines:

```
score-base/v1
scoring_contract_version
evaluation_partition_receipt_digest_hex
venue
market
symbol
primary_horizon_minutes
anchor_closed_bar_epoch_ms
target_definition_digest_hex
component_layout_version
normalization_version_digest_hex
```

| Field | Rule |
|-------|------|
| `scoring_contract_version` | `energy-mc/v1` |
| `evaluation_partition_receipt_digest_hex` | 64-char lowercase hex of partition receipt (WF_PREDICTIVE for STAGE-A scoring) |
| `anchor_closed_bar_epoch_ms` | int64 decimal ASCII |
| `target_definition_digest_hex` | execution-opportunity target definition for joint 13-D scoring |
| `component_layout_version` | `exec-opp-13d-v1` |

**MUST EXCLUDE:** challenger id; model_transform_version; package content digest; any model-specific artifact digest.

`score_base_seed = SHA256(canonical_byte_stream)` → 32 bytes.

#### Step 2 — `scoring_stream_identity_digest`

```
score-stream-id/v1
score_base_seed_hex
scoring_stream_contract_version
S
D_SCORE_MAX
component_layout_version
normalization_version_digest_hex
```

| Field | Frozen value |
|-------|--------------|
| `score_base_seed_hex` | 64-char hex of `score_base_seed` |
| `scoring_stream_contract_version` | `score-stream/v1` |
| `S` | decimal ASCII (`S = K·M`) |
| `D_SCORE_MAX` | `16` |

`scoring_stream_identity_digest = SHA256(canonical_byte_stream)`.

#### Step 3 — CRN draw addressing

For each `(s, d)` with `s ∈ {0..S-1}`, `d ∈ {0..D_SCORE_MAX-1}`:

- `score_root = SHA256( score_root_prefix_16 ‖ scoring_stream_identity_digest_32 )`
- Draw via domain **`SCORECRN1`**: `replica_u32 = s`, `sample_u32 = d`, `draw_u32 = 0`, **`retry_u32 = 0` exactly** — frozen for every coordinate `(s,d)`; no rejection loop; no retry increment; no mutable cursor
- One `WAIA_RANDOM_BLOCK_V1` SHA-256 block → one uint53 numerator: `U_s[d] = (uint64_be(block[0:8]) >> 11) / 2^53`
- **`UNBIASED_INT` MUST NOT be used for SCORECRN1** — integer rejection semantics apply only where actually required (`EPIBOOT1`, `ALEDRAW1` empirical-pool index draws, `VALBOOT1`)
- **Regression (mandatory):** any implementation that sets `retry_u32 ≠ 0` for `SCORECRN1`, or re-draws blocks for SCORECRN1, is **invalid contract usage**

**Index 0 (`d=0`)** = replica-selection CRN coordinate (Gate-D F2 recovered). Every compared model at the same anchor consumes **identical** `(s,d)` addresses; unused dimensions are ignored by the scorer but still hashed for replay verification.

#### Step 4 — `scoring_stream_semantic_digest`

Streaming SHA-256 over **actual uint53 numerators** (NOT scale-8 quantized uniforms):

```
for s = 0 .. S-1:
  for d = 0 .. D_SCORE_MAX-1:
    numerator_u53 = floor(U_s[d] * 2^53)   // exact integer in [0, 2^53-1]
    append uint64_be(numerator_u53)
```

`scoring_stream_semantic_digest = SHA256(numerator_stream)`.

**Replay:** Identical `scoring_stream_identity_digest` + qualified runtime → identical `scoring_stream_semantic_digest`. Mismatch → fail closed **`SCORING_STREAM_REPLAY_MISMATCH`**.

**Forbidden:** mutable RNG; model-dependent score base; hashing scale-8 quantized uniforms; executor-selected JSON for identity digests.

### 2.8 energy-mc/v1

`MC_ES = (1/S)Σ||x_s-y||_2 - (1/(2J))Σ||x_{2j-1}-x_{2j}||_2` on normalized 13-D space; O(S·d); Monte Carlo estimate not exact all-pairs score.

**K/M convergence gate (F2 — frozen interpretation):** WP-EXECOPP-QUAL computes `energy-mc/v1` from the **common nested ALEDRAW1 sample cube** `X[k,m]` (§2.10 F2) — deterministic pairing over the included prefix `X[0:K, 0:M]`. **Does NOT use `SCORECRN1`.** No second cell-specific randomization layer. **`SCORECRN1`** (§2.7 D3) applies only to scientific model/baseline comparison in WP-RESEARCH-HARNESS / challenger trials outside this numerical K/M convergence measurement.

### 2.9 Qualified runtime tuple (authoritative determinism boundary)

`{os_class, arch, node_version_exact, code_release_sha, sampler_contract_version, model_transform_version, quantizer_version, artifact_digest}` — equality guaranteed only inside OG-HOST-QUAL receipt match. No universal cross-platform bit-equality claim.

### 2.10 Non-circular identity digest DAG (C2)

**Rule:** No digest may seed data needed to create itself (directly or indirectly). Every digest MUST be computable in strict topological order. Property tests MUST verify the DAG.

#### Top-level line-oriented identity encoding (E1)

All line-oriented scientific identities below use **one** canonical line encoding (UTF-8; exactly one field value per line; each line terminated by exactly one `0x0A`). **No JSON.** No locale formatting. No implicit `Number.toString` authority. **No raw32** inside these line-oriented identities — SHA-256 digest-valued fields appear only as `_hex` (64 lowercase ASCII hex chars, no `0x` prefix).

Applies to: **`replica-root-family/v1`**, **`pkg-gen-id/v2`**, **`forecast-sampling-family/v1`**, **`fcst-gen-id/v1`**.

| Type | Encoding |
|------|----------|
| Version prefix line | UTF-8 ASCII value + exactly one `0x0A` |
| UUID (`organization_id`) | RFC-4122 lowercase hyphenated; exactly 36 ASCII chars + `0x0A` |
| Enum / version / string ids | UTF-8 ASCII; MUST NOT contain `0x0A` inside value; value + `0x0A` |
| Integer (`*_dec`, horizons, K/M) | Base-10 ASCII; no leading `+`; no leading zero except literal `0`; value + `0x0A` |
| SHA-256 digest (`*_digest_hex`) | Exactly 64 lowercase `[0-9a-f]` + `0x0A` |
| `code_release_sha` | Exact lowercase Git commit hex (40 chars for SHA-1 object name; no prefix) + `0x0A` |
| `alpha_epi_config_scale8` | `quantizeScale8HalfUp/v1` canonical string for first-program configured α_epi=`0.10` → UTF-8 `0.10000000` + `0x0A` (frozen configuration value; no executor float stringification) |
| `K_config_dec` / `M_config_dec` | Exact **model-configuration** epistemic replica count K and aleatoric draw count M used to **generate/evaluate** this package candidate (decimal ASCII integers). **Configuration values — NOT** Human-approved, capital-authorized, admitted, or selected-winner authority state. Rejected grid cells retain immutable research identities. |

#### Common epistemic replica-root family (F2)

**`replica_root_family_identity_digest`** — configuration-independent stochastic family for all K/M qualification configurations sharing the same `(symbol,h,model/data)` scientific experiment.

Canonical serialization (`replica-root-family/v1`; field order frozen):

```
replica-root-family/v1
organization_id
venue
market
symbol
primary_horizon_minutes_dec
execution_horizon_minutes_dec
package_subject_version
terminal_target_definition_digest_hex
execution_opportunity_target_definition_digest_hex
model_transform_version
development_dataset_digest_hex
feature_version
normalization_version_digest_hex
sampler_contract_version
quantizer_version
code_release_sha
```

**MUST EXCLUDE:** `K_config_dec`; `M_config_dec`; `alpha_epi_config_scale8`; H3 Human receipt; scientific admission state; result-dependent fields.

`replica_root_family_identity_digest = SHA256(exact replica-root-family/v1 bytes)`

**Known-answer tests (mandatory):** fixed `replica-root-family/v1` byte vector → fixed 32-byte digest; changing `K_config`/`M_config`/`alpha_epi_config` MUST NOT change `replica_root_family_identity_digest`.

**Bootstrap roots (common nested K surface — F2):**

```
bootstrap_root_k = SHA256(
  bootstrap_root_prefix_16
  ‖ replica_root_family_identity_digest_32
  ‖ uint32_be(k)
)
```

for `k = 0..49` (`K_max = 50`). This root surface is **identical** across every K/M cell in the same qualification family:

| K cell | Uses replicas |
|--------|---------------|
| K=10 | `k = 0..9` |
| K=20 | `k = 0..19` |
| K=30 | `k = 0..29` |
| K=40 | `k = 0..39` |
| K=50 | `k = 0..49` |

Lower-K configurations are an **exact prefix** of every containing higher-K configuration. Changing K MUST NOT redraw shared replicas. Changing M MUST NOT redraw any epistemic replica. `alpha_epi_config` MUST NOT change bootstrap roots.

#### Candidate package generation identity (F1 + F2)

**`predictive_package_generation_identity_digest`** — binds **configuration** atop the common stochastic family; computed **before** bootstrap refits; distinct per K/M cell.

Canonical serialization (`pkg-gen-id/v2`; supersedes `pkg-gen-id/v1` for candidate configuration binding):

```
pkg-gen-id/v2
replica_root_family_identity_digest_hex
K_config_dec
M_config_dec
alpha_epi_config_scale8
```

| Field | Exact encoding |
|-------|----------------|
| `replica_root_family_identity_digest_hex` | 64-char hex of common family digest |
| `K_config_dec` | configured epistemic replica count K for this candidate (e.g. grid cell `20` or reference `50`) |
| `M_config_dec` | configured aleatoric draw count M for this candidate (e.g. grid cell `40` or reference `80`) |
| `alpha_epi_config_scale8` | frozen configuration `0.10000000` for first-program α_epi=0.10 |

`predictive_package_generation_identity_digest = SHA256(exact pkg-gen-id/v2 bytes)`

**Conceptual separation (F2):** `COMMON stochastic family + (K_config, M_config, alpha config) = candidate configuration identity`. Different candidate identity MUST NOT imply different shared bootstrap coordinates.

**Known-answer tests (mandatory):** fixed `pkg-gen-id/v2` byte vector → fixed digest; **F1:** `K_config`/`M_config`/`alpha_epi_config` change changes candidate digest; Human H3 metadata MUST NOT alter precomputed digests; **F2:** same `k` has identical `bootstrap_root_k` across all K/M cells; K=10 replica set is exact prefix of K=20/30/40/50; cell identity changes when K/M changes but shared stochastic coordinates do not.

**MUST NOT include:** replica artifact digests; bootstrap roots; `predictive_package_content_digest`; Human H3 receipt identity; capital-admission authority state.

#### Configuration vs Human ratification (F1)

Package generation identity binds **exact model configuration**, not whether Human has already ratified it.

| Phase | Authority |
|-------|-----------|
| A. Preregister common stochastic family + K/M grid | `replica-root-family/v1` + K∈{10,20,30,40,50}, M∈{20,40,80} (15 configurations) |
| B. Build/address common reference surface | `K_max=50`, `M_max=80`; nested prefixes only (**F2**) |
| C. Generate/evaluate all 15 nested-prefix configurations | Each cell: `pkg-gen-id/v2` + shared bootstrap/draw coordinates |
| D. K/M convergence evidence | Produced from evaluated candidates (WP-EXECOPP-QUAL) |
| E. Deterministic selection rule | Yields one exact `(K_config, M_config, alpha_epi_config)` candidate tuple |
| F. Human H3 review | Reviews evidence for the selected tuple |
| G. Human H3 ratification | Ratifies or rejects the selected tuple |
| H. Capital/scientific admission | Receipt binds `replica_root_family_identity_digest`, selected `K_config_dec`, `M_config_dec`, `alpha_epi_config_scale8`, `predictive_package_generation_identity_digest`, `predictive_package_content_digest`, and H3 Human receipt identity |

**Forbidden cycle:** Human H3 approval MUST NOT be an input required to construct a candidate package identity or stochastic family. Selection MUST NOT regenerate bootstrap replicas or aleatoric samples under a different random identity. Rejected candidates remain research evidence only; no package acquires capital authority merely because it has a package digest.

#### Nested stochastic reference surface (F2)

For every `(symbol,h,anchor)` in the K/M qualification experiment, build/equivalently address the maximal reference surface:

- `K_max = 50`
- `M_max = 80`

Conceptual sample cube: `X[k,m]` for `k = 0..49`, `m = 0..79`.

Each preregistered configuration `(K,M)` evaluates using **exactly** `X[0:K, 0:M]` — no independent cell-specific stochastic simulation; no cell-specific bootstrap seed; no cell-specific aleatoric seed.

Reference configuration: `(50,80)` contains every lower cell as a prefix.

#### Common aleatoric sampling family (F2)

**`forecast_sampling_family_identity_digest`** — pre-sampling identity per `(replica-root family, anchor)`; common draw surface across all M cells.

Canonical serialization (`forecast-sampling-family/v1`; field order frozen):

```
forecast-sampling-family/v1
replica_root_family_identity_digest_hex
organization_id
venue
market
symbol
anchor_closed_bar_epoch_ms_dec
primary_horizon_minutes_dec
execution_horizon_minutes_dec
runtime_contract_digest_hex
```

**MUST EXCLUDE:** `K_config`; `M_config`; `alpha_epi_config`; `predictive_package_content_digest`; H3/admission status; generated samples; `distribution_semantic_digest`.

`forecast_sampling_family_identity_digest = SHA256(exact forecast-sampling-family/v1 bytes)`

**Aleatoric root (common nested M surface — F2):**

```
aleatoric_root_t = SHA256(
  aleatoric_root_prefix_16
  ‖ forecast_sampling_family_identity_digest_32
)
```

`ALEDRAW1` addressing: `(k, m, draw, retry)`. For the same anchor and replica `k`:

| M cell | Uses draws |
|--------|------------|
| M=20 | `m = 0..19` |
| M=40 | `m = 0..39` |
| M=80 | `m = 0..79` |

M=20 is an **exact draw-prefix** of M=40 and M=80. Changing M MUST NOT change any shared draw. Changing K MUST NOT change any draw for shared replica `k`.

**Known-answer tests (mandatory):** fixed `forecast-sampling-family/v1` byte vector → fixed digest; same `(anchor,k,m)` has identical ALEDRAW1 address/block across all cells containing it.

#### Bootstrap → replica artifacts

Let `K = K_config_dec` from the sealed `pkg-gen-id/v2` identity (configuration-bound prefix length; computable **before** H3).

For each `k ∈ {0..K-1}`:

1. `bootstrap_root_k = SHA256( bootstrap_root_prefix_16 ‖ replica_root_family_identity_digest_32 ‖ uint32_be(k) )` — **no Human receipt**; **no K/M/alpha in root** (F1+F2)
2. Run `stationary-bootstrap/v1` on DEVELOPMENT SOURCE corpus `D`
3. Refit; seal `replica_artifact_digest_k` per **§2.11.3** (exact artifact serialization)

**Package refit invalidation (C4):** if any replica has non-finite `q1/q2`, `q1_k >= q2_k`, corrupt pool digest, or invalid bootstrap reconstruction → package **`FORECAST_EPISTEMIC_REPLICA_INVALID`**; not scientifically admissible.

#### Package content (only after all replica artifacts exist)

```
predictive_package_content_digest = SHA256(
  ASCII("pkg-content/v1") ‖ 0x00
  ‖ predictive_package_generation_identity_digest_32
  ‖ replica_artifact_digest_0 ‖ ... ‖ replica_artifact_digest_{K-1}
)
```

Ordered by ascending `replica_ordinal`. **No** bootstrap root may depend on this digest.

#### Forecast issuance layer (before aleatoric generation)

**`forecast_generation_identity_digest`** — computed **before** drawing aleatoric samples.

Canonical serialization (`fcst-gen-id/v1`; field order frozen):

```
fcst-gen-id/v1
predictive_package_content_digest_hex
organization_id
venue
market
symbol
anchor_closed_bar_epoch_ms_dec
primary_horizon_minutes_dec
execution_horizon_minutes_dec
terminal_target_role_id
execution_target_role_id
runtime_contract_digest_hex
```

| Field | Exact encoding |
|-------|----------------|
| `predictive_package_content_digest_hex` | 64-char lowercase hex of sealed package content digest |
| `organization_id` | UUID line |
| `venue`, `market`, `symbol` | UTF-8 ASCII id lines |
| `anchor_closed_bar_epoch_ms_dec` | int64 decimal ASCII |
| `primary_horizon_minutes_dec`, `execution_horizon_minutes_dec` | int decimal ASCII |
| `terminal_target_role_id` | e.g. `TERMINAL_RETURN` |
| `execution_target_role_id` | e.g. `EXECUTION_OPPORTUNITY` |
| `runtime_contract_digest_hex` | 64-char lowercase hex of §2.11.2 digest (pre-generation qualified runtime tuple only) |

`forecast_generation_identity_digest = SHA256(exact fcst-gen-id/v1 bytes)`

**Known-answer tests (mandatory):** fixed `fcst-gen-id/v1` byte vector → fixed 32-byte digest; distinct `predictive_package_content_digest_hex` or anchor epoch → distinct forecast generation identity digest.

**Design note (D1):** `replica_set_identity_digest` **removed** — redundant with ordered replica artifacts already bound in `predictive_package_content_digest`; avoids circular/redundant semantics.

**MUST EXCLUDE:** `distribution_semantic_digest`; `forecast_content_digest`; any field derived from generated aleatoric samples.

#### Aleatoric generation

`aleatoric_root_t = SHA256( aleatoric_root_prefix_16 ‖ forecast_sampling_family_identity_digest_32 )` — per **§2.10 F2**; **not** derived from `forecast_generation_identity_digest` or candidate `K_config`/`M_config`.

Draw M samples per replica via `ALEDRAW1` ordinals `(k,m,draw)` using nested draw prefix `m ∈ {0..M_config_dec-1}` of the common `M_max=80` surface.

#### Forecast content (only after deterministic sample generation)

```
forecast_content_digest = SHA256(
  ASCII("fcst-content/v1") ‖ 0x00
  ‖ forecast_generation_identity_digest_32
  ‖ distribution_semantic_digest_32
)
```

#### Topological order (mandatory test spec)

```
development/model semantics
  → replica_root_family_identity_digest
  → bootstrap_root_k
  → replica_artifact_digest_k

(replica_root_family_identity_digest
 + K_config + M_config + alpha_epi_config)
  → predictive_package_generation_identity_digest
  → predictive_package_content_digest

(replica_root_family_identity_digest
 + anchor/runtime)
  → forecast_sampling_family_identity_digest
  → aleatoric_root_t
  → shared aleatoric sample coordinates

(candidate package content
 + anchor/runtime)
  → forecast_generation_identity_digest
  → distribution_semantic_digest
  → forecast_content_digest
```

**Fail-closed:** any cycle detection in identity construction → `FORECAST_IDENTITY_DAG_CYCLE`. No Human receipt as a generation prerequisite.

#### F2 mandatory regression properties

1. Same root-family inputs → same `replica_root_family_identity_digest`.
2. K/M/alpha changes do **not** change `replica_root_family_identity_digest`.
3. Same `k` has identical `bootstrap_root_k` in every K/M configuration.
4. K=10 replica set is exact prefix of K=20/30/40/50.
5. Same `(anchor,k,m)` has identical ALEDRAW1 address/block across all cells containing it.
6. M=20 is exact draw-prefix of M=40/80.
7. K/M cell identity (`pkg-gen-id/v2`) changes when K/M changes.
8. Shared stochastic coordinates do **not** change when K/M cell identity changes.
9. Selected H3 candidate references exact previously evaluated candidate.
10. H3 does not regenerate any stochastic surface.
11. All 15 configurations use identical ordered **16384 unique anchors** (§ WP-EXECOPP-QUAL).
12. Convergence PASS/FAIL cannot depend on independent per-cell seed choice.

### 2.11 Byte-exact nested digest contracts (D1–D4)

No authority-critical digest may use placeholder prose (`identity fields`, `contract identity`, etc.). All digests below use **SHA-256** over the exact byte streams defined. Digest-valued fields embed as **32-byte binary** unless a field explicitly says `_hex` (64 lowercase ASCII hex chars).

#### 2.11.1 Field encoding rules (all §2.11 digests)

| Type | Encoding |
|------|----------|
| Version prefix line | UTF-8 ASCII + `\n` |
| Enum/string ids | UTF-8 ASCII + `\n`; MUST NOT contain `\n` in value |
| uint32 | decimal ASCII + `\n` |
| int64 epoch ms | decimal ASCII + `\n` |
| scale-8 decimal | `quantizeScale8HalfUp/v1` canonical string UTF-8 + `\n` |
| 32-byte digest inline | raw 32 bytes (no hex) when field name has no `_hex` suffix |
| 32-byte digest hex | 64 lowercase hex chars + `\n` when field name ends `_hex` |

#### 2.11.2 `runtime_contract_digest`

Binds **only** values known before Forecast generation (OG-HOST-QUAL qualified tuple subset). **Excludes** forecast output digests and per-issuance samples.

Canonical stream (`runtime-contract/v1`):

```
runtime-contract/v1
os_class
arch
node_version_exact
code_release_sha
sampler_contract_version
model_transform_version
quantizer_version
energy_mc_version
```

| Field | Example / rule |
|-------|----------------|
| `sampler_contract_version` | `waia-cbrng/sha256-ctr/v1` |
| `quantizer_version` | `quantizeScale8HalfUp/v1` |
| `energy_mc_version` | `energy-mc/v1` |

`runtime_contract_digest = SHA256(canonical_byte_stream)`.

Included in `forecast_generation_identity_digest` as lowercase hex line (64 chars).

#### 2.11.3 `replica_artifact_digest_k` (`rv-state-conditional-empirical-joint/v1`)

Exact artifact byte stream (`replica-artifact/v1`); **no JSON**:

```
replica-artifact/v1
model_transform_version
replica_ordinal_dec
symbol
primary_horizon_minutes_dec
fit_partition
L_block_dec
bootstrap_root_k_raw32
q1_scale8
q2_scale8
state_edges_version
n_S0_dec
n_S1_dec
n_S2_dec
pool_semantic_digest_S0_raw32
pool_semantic_digest_S1_raw32
pool_semantic_digest_S2_raw32
```

| Field | Encoding |
|-------|----------|
| `replica_ordinal_dec` | decimal ASCII + `\n` |
| `fit_partition` | ASCII `development` + `\n` |
| `L_block_dec` | decimal ASCII + `\n` |
| `bootstrap_root_k_raw32` | exactly 32 bytes immediately after newline of prior field (no line terminator inside) |
| `q1_scale8`, `q2_scale8` | quantizeScale8HalfUp/v1 + `\n` |
| `state_edges_version` | `type7-tertile/v1` + `\n` |
| `n_S*_dec` | decimal ASCII + `\n` |
| `pool_semantic_digest_S*_raw32` | each exactly 32 bytes concatenated in order S0,S1,S2 |

`replica_artifact_digest_k = SHA256(entire_stream)`.

#### 2.11.4 `pool_semantic_digest`

Exact pool byte stream (`pool-sem/v1`) for `(symbol, h, replica_k, state)`:

```
pool-sem/v1
organization_id
venue
market
symbol
primary_horizon_minutes_dec
replica_ordinal_dec
state_id
feature_version
outcome_version
state_assignment_version
development_dataset_digest_raw32
n_pool_dec
```

Then for each observation **`j` ascending `resample_position_ordinal`** (post state-filter):

```
resample_position_ordinal_dec
closed_bar_epoch_ms_dec
venue
market
symbol
outcome_13d_block
```

| Subfield | Rule |
|----------|------|
| `state_id` | `S0`, `S1`, or `S2` + `\n` |
| `outcome_version` | `exec-opp-outcome/v1` + `\n` |
| `state_assignment_version` | `rv-state-tertile/v1` + `\n` |
| `development_dataset_digest_raw32` | 32 bytes |
| `outcome_13d_block` | 13 lines × scale-8 HALF_UP canonical strings, UTF-8, each line `\n`-terminated (same as §2.4.2) |

`pool_semantic_digest = SHA256(entire_stream)`.

**Bounded replay:** pools reconstructed from DEVELOPMENT SOURCE + `bootstrap_root_k` + §2.4.0; digest recomputed before sampling.

#### 2.11.5 `trial_identity_digest_32` (D4 + E3)

Exact trial identity (`trial-id/v2`); seeds validation bootstrap root. **E3 disposition:** `holm_family_index_dec` is **removed** from trial identity — downstream Holm rank/order is derived from observed p-values and **MUST NOT** influence bootstrap RNG used to generate those p-values.

Canonical serialization (`trial-id/v2`; UTF-8 line encoding per §2.10 / §2.11.1):

```
trial-id/v2
trial_registration_id
challenger_package_content_digest_hex
challenger_model_transform_version
baseline_id
baseline_version
score_metric_id
score_metric_version
symbol
primary_horizon_minutes_dec
evaluation_partition_receipt_digest_hex
common_anchor_set_digest_hex
purge_duration_minutes_dec
embargo_duration_minutes_dec
comparison_family_id
```

| Field | Rule |
|-------|------|
| `trial_registration_id` | preregistered trial id string + `\n` |
| `challenger_package_content_digest_hex` | 64-char lowercase hex |
| `challenger_model_transform_version` | model version string + `\n` |
| `baseline_id` | e.g. `empirical-joint/v1` |
| `baseline_version` | baseline version string + `\n` |
| `score_metric_id` | e.g. `log-score/v1` or `energy-mc/v1` |
| `score_metric_version` | metric version string + `\n` |
| `evaluation_partition_receipt_digest_hex` | WF_PREDICTIVE receipt for STAGE-A trials |
| `common_anchor_set_digest_hex` | SHA-256 hex of ordered anchor id list |
| `purge_duration_minutes_dec`, `embargo_duration_minutes_dec` | int decimal ASCII + `\n` |
| `comparison_family_id` | binds preregistered Holm family scope (family membership; **not** post-result rank) |

**Explicitly excluded from trial identity (E3):** `holm_family_index_dec`; any Holm rank/order; any field derived from observed p-values.

`trial_identity_digest_32 = SHA256(exact trial-id/v2 bytes)`.

`validation_bootstrap_root = SHA256( validation_bootstrap_root_prefix_16 ‖ trial_identity_digest_32 )`.

**Holm procedure (post-bootstrap; rank MUST NOT seed RNG):**

1. Compute all raw pairwise bootstrap p-values first (each pairwise comparison has deterministic `validation_bootstrap_root` from its `trial-id/v2` identity — challenger package, baseline, metric, symbol, horizon, partition, anchor set, purge/embargo, `comparison_family_id`).
2. Collect the exact preregistered family identified by `comparison_family_id`.
3. Order p-values according to the frozen Holm algorithm.
4. Apply Holm FWER=0.05.

Post-result Holm rank/index **MAY** be persisted in the scientific receipt for audit; it **MUST NOT** seed or modify any bootstrap random stream.

**Known-answer tests:** fixed `trial-id/v2` byte vector → fixed digest; distinct `comparison_family_id` → distinct bootstrap root; **regression:** permuting storage or evaluation order of family comparisons MUST NOT change any pairwise raw bootstrap p-value.

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

**Design:** Enforce `Forecast → Decision → deterministic desired-size → Portfolio → Risk (downward-only) → Execution` and kill/flatten/HALT fold; encode Strategy/Hypothesis authority firewalls including **`StrategySignal.maxRisk` quarantine** (§1.20); document FHV-v1 narrow Guardian policy as subset of `FHV_EXECUTABLE_POLICY_V1` (§1.22–§1.24).

**Forbidden:** Decision consulting downstream Risk allowance; Decision using legacy strategy edge/confidence/**maxRisk** for EV/actionability/sizing; Risk improving proposals; post-HALT emergency trading; claiming FHV-v1 proves mature exit intelligence; using K/M scientific notional grid as FHV sizing.

**Tests:** authority ordering regression; kill-fold integration; strategy-mutation non-effect on V2 EV and desired-size; hypothesis-confidence firewall; maxRisk quarantine on V2 sizing path.

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

**Design:** Implement migrations 0110–0129 (§1.10). Package-level `bytea` artifacts ≤64KiB/replica. Per-forecast compact seal with `distribution_semantic_digest` (§2.5.2). Non-circular identity DAG (§2.10) + byte-exact nested digests (§2.11). `replica-root-family/v1` + `pkg-gen-id/v2` bind common stochastic family + `(K_config_dec, M_config_dec, alpha_epi_config_scale8)` as **configuration** values computable before H3 (§2.10 F1+F2). `forecast-sampling-family/v1` common aleatoric surface per anchor. `trader_forecast_predictive_package_target_v2` two-role binding. `quantizeScale8HalfUp/v1` + byte-exact `WAIA_RANDOM_BLOCK_V1` (§2.6) + `stationary-bootstrap/v1` (§2.4.0). No `trader_forecast_exec_sample_v2`. Terminal = deterministic projection of package onto `R_h`. **Epistemic replicas** = DEVELOPMENT `stationary-bootstrap/v1` refits; **canonical pools** with SOURCE vs bootstrap multiplicity (§2.4.2). Fixed-K fail-closed (§4.1). Heuristic hypothesis confidence is **not** a Forecast V2 probability input (§1.21).

**Fail-closed:** `FORECAST_DISTRIBUTION_REPLAY_MISMATCH`, `FORECAST_MODEL_ARTIFACT_DIGEST_MISMATCH`, `EXEC_OPP_NORMALIZATION_DEGENERATE_COMPONENT`, `FORECAST_RUNTIME_QUALIFICATION_MISMATCH`.

**Storage test:** PHASE 0–3 protocol (§8 below).

**Dependencies:** WP-CANON, WP-FEATURE-RV.

**Risk:** T1.

**DoD:** Storage-scale integration test PASS; replay determinism tests; bundle completeness triggers.

---

### WP-DECISION-ECON — DEE-528

**Purpose:** Execution-aware conservative Decision economics; fail-closed without admission receipt; Strategy/Hypothesis non-authority.

**Current seams:** `build-decision-record.ts`, `forecast-decision-service.ts`, `historical-simulated-exchange.ts`, `cost-model.ts`.

**Design:** O(K) streaming EV over regenerated sample streams from **epistemic replicas** (§2.4.0–§2.4.1). **`DECISION_ECONOMIC_PAYOFF_POLICY`** aligned with `FHV_EXECUTABLE_POLICY_V1` (§1.25); scientific scoring may use `SCIENTIFIC_VALUATION_CONTRACT_V1` separately. Residual lower floor 0 USDT in `Pi_lower`. `DECISION_ACTIONABLE` without Risk term and without StrategySignal confidence/expectedEdge/maxRisk. Capital admission consumes scientific-admission receipt on **WF_PREDICTIVE**; **`HUMAN_FHV_EXECUTABLE_POLICY_V1`** + **`HUMAN_ECONOMIC_UTILITY_ACCEPTANCE_V1`** (both before WF_ECONOMIC evidence) + economic-utility PASS required before `FROZEN_SELECTED_PACKAGE_READY` (§1.19). Emit interfaces for STAGE-B on **WF_ECONOMIC** binding `executable_policy_digest`.

**Forbidden:** Risk in actionability; legacy strategy edge/maxRisk as EV or sizing authority; heuristic hypothesis confidence as probability; using runtime Guardian exits to rewrite scientific valuation A; retuning after economic-utility results; K/M notional grid as FHV sizing.

**Dependencies:** WP-FORECAST-V2, WP-EXEC-ACCT, WP-AUTHORITY. **NOT** hard-dep WP-EXECOPP-QUAL (runtime receipt only).

**Risk:** T1.

**DoD:** EV ordering tests; firewall regressions; fail-closed without receipt; scientific liquidation mechanics tests; economic-utility receipt schema ready for OG-SCI-PACKAGE STAGE-B.

**Human gate:** H3 before capital; `HUMAN_FHV_EXECUTABLE_POLICY_V1` + `HUMAN_ECONOMIC_UTILITY_ACCEPTANCE_V1` before WF_ECONOMIC evidence.

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

**Design:** Immutable qualification receipts; holdout redaction; PIT boundary enforcement; gap/duplicate policy; **logical sub-partitions** `WF_PREDICTIVE` and `WF_ECONOMIC` bound in receipts (§1.4).

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

**Validation protocol:** log score; significance bootstrap via **`stationary-bootstrap/v1` + `VALBOOT1`** (§2.6.1): `B=10000`, `validation_bootstrap_root` from `trial_identity_digest_32`, integer-exact `L`; Holm FWER 0.05; common anchor set per `(symbol,h,challenger)` on **WF_PREDICTIVE**; purge/embargo=h; beat EVERY mandatory baseline. **Forbidden:** `SHA256(trial_id) mod 2^32`; mutable PRNG.

**Target grid ceremony:** dev quantiles {0.05,0.20,0.40,0.60,0.80,0.95} → 7 buckets; `authority_status=RESEARCH_ONLY` until Human ratified.

**Dependencies:** WP-FORECAST-V2, WP-DATASET-QUAL.

**Risk:** T1.

**DoD:** Validation bootstrap known-answer (§2.6.1); epistemic bootstrap known-answer (§2.4.0); identity DAG acyclicity tests (§2.10); Holm known-answer; CDF kernel vectors vs § frozen table; betainc-lentz recurrence tests; epistemic K≠M separation; fixed-K fail-closed property tests (§4.1); WAIA_RANDOM_BLOCK_V1 prefix-byte tests (§2.6).

---

### WP-EXECOPP-QUAL — DEE-532

**Purpose:** Joint Execution Opportunity qualification + K/M convergence gate; emits STAGE-A scientific-admission inputs (predictive on **WF_PREDICTIVE**), not economic-utility PASS.

**Joint baselines:** `empirical-joint/v1` (unbiased dev anchor index); `marginal-independence/v1` (type-7 empirical inverse CDF per component).

**K/M grid:** K∈{10,20,30,40,50}, M∈{20,40,80} (15 **configurations**); reference `(50,80)`; scale grid {0.01,0.05,0.10,0.25,0.50}·C0 for **scientific sensitivity reporting only** — MUST NOT become `FHV_EXECUTABLE_POLICY_V1` sizing (§1.23); ev_rate=EV/notional; relative error denominator max(|ev_rate_ref|,5e-5); 95th-pct max over notionals; thresholds 0.01 EV / 0.02 MC_ES.

**Anchor set (terminology frozen — F2):** **4096 unique anchors per `(symbol,h)` evaluation surface**. First program has four symbol/h surfaces: BTCUSDT/30m, BTCUSDT/60m, ETHUSDT/30m, ETHUSDT/60m → **`4 × 4096 = 16384` unique anchors TOTAL**. ALL 15 K/M configurations MUST be evaluated on the **same** 16384 unique anchor set (not 4096 independently resampled anchors per configuration). Reporting may count `15 × 16384 = 245760` configuration-anchor evaluations, but only **16384 UNIQUE** anchors exist.

**F1+F2 nested stochastic surface (mandatory):** Preregister `replica-root-family/v1` once per `(symbol,h,model/data)` family. Build/address common reference surface `K_max=50`, `M_max=80`. Each of the 15 configurations evaluates nested prefix `X[0:K, 0:M]` only — shared bootstrap roots from `replica_root_family_identity_digest`; shared aleatoric draws from `forecast_sampling_family_identity_digest` per anchor. Each configuration receives immutable `pkg-gen-id/v2` candidate identity (`replica_root_family_identity_digest_hex` + `K_config_dec` + `M_config_dec` + `alpha_epi_config_scale8`) → `predictive_package_generation_identity_digest` → `predictive_package_content_digest`. K/M convergence computes `energy-mc/v1` from common ALEDRAW1 cube (**not** SCORECRN1 — §2.8). Deterministic selection rule identifies one exact candidate tuple. **H3 Human ratification** attaches authority to that **already-evaluated** candidate. Human approval MUST NOT mutate or regenerate candidate identity or stochastic surfaces.

**Dependencies:** WP-FORECAST-V2, WP-VOLUME-QUAL, WP-RESEARCH-HARNESS.

**Risk:** T1.

**DoD:** K/M selection receipt (references `replica_root_family_identity_digest` + exact selected candidate digests); predictive scientific-admission receipt for STAGE-A; nested-prefix regression tests (§2.10 F2); does **not** alone emit `FROZEN_SELECTED_PACKAGE_READY`.

**Human gate:** H3 ratification of the **selected** `(K_config, M_config, alpha_epi_config=0.10)` candidate tuple **after** K/M convergence evidence — blocks capital eligibility only; does **not** block candidate identity or stochastic-family construction.

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
7. Sampler/artifact/replay semantics are fully frozen (`stationary-bootstrap/v1`, `WAIA_RANDOM_BLOCK_V1` §2.6, `quantizeScale8HalfUp/v1`, `distribution_semantic_digest` §2.5.2, nested digests §2.11).
8. A package that reaches STAGE-A predictive pass may become `FROZEN_SELECTED_PACKAGE_READY` **only after** `HUMAN_FHV_EXECUTABLE_POLICY_V1` + STAGE-B `ECONOMIC_UTILITY_PASS` (§1.19).

Any challenger marked `EXECUTOR_READY` must satisfy all eight points.

---

### 4.1 `rv-state-conditional-empirical-joint/v1` — **EXECUTOR_READY**

Full-joint conditional empirical challenger with **Gate-D epistemic bootstrap replicas**. Terminal and Execution Opportunity are deterministic projections of the **same** sealed joint sample set **per replica**.

| Field | Specification |
|-------|---------------|
| Package roles | `TERMINAL_RETURN` @ `h` + `EXECUTION_OPPORTUNITY` @ `h+3` from one package |
| State variable (PIT) | `realizedVol20m_1m` at anchor `t` from `feature-engine/rv/v2` — uses only closes in `(t-20m, t]` |
| **Epistemic replica k** | `stationary-bootstrap/v1` **refit** of DEVELOPMENT SOURCE corpus `D` → bootstrap multiset `D_k` (§2.4.0–§2.4.2). On `D_k`, compute type-7 tertile edges `{q1_k,q2_k}` and state-conditional pools preserving bootstrap multiplicity. **Edges are refit per replica** — not fixed from a single parent fit. |
| State boundaries (per replica) | On bootstrap multiset `D_k`: empirical tertiles `p ∈ {1/3, 2/3}` via type-7 on `realizedVol20m_1m` → `q1_k < q2_k` |
| State assignment at `t` for replica k | Using **replica k edges**: `S0` if `rv ≤ q1_k`; `S1` if `q1_k < rv ≤ q2_k`; `S2` if `rv > q2_k` (`rv==q1_k → S0`; `rv==q2_k → S1`) |
| Replica training pool | Canonical ordered bootstrap observations in `D_k` with PIT-valid resolved 13-D outcomes and state assignment under edges `(q1_k,q2_k)` — ascending `resample_position_ordinal` after state filter (§2.4.2) |
| Min pool count / fixed-K semantics (C4) | **K is FIXED** — no `K_eff`, no silent replica drop. At package refit: non-finite `q1/q2`, `q1_k >= q2_k`, corrupt pool digest, invalid bootstrap reconstruction → **`FORECAST_EPISTEMIC_REPLICA_INVALID`** (package not admissible). At issuance: if anchor selects state for replica `k` with `|pool_{k,state}| < 30` → entire Forecast **`FORECAST_EPISTEMIC_STATE_POOL_INSUFFICIENT`** → INVALID / NON_ACTIONABLE. Forbidden: drop replica, renormalize K, backoff to another state, unconditional pool, synthesize samples |
| **Aleatoric draws m** | From replica k's sealed state pool only: unbiased index via `WAIA_RANDOM_BLOCK_V1` domain **`ALEDRAW1`**, ordinals `(k,m,draw)`; emit observed 13-D vector — **no parametric density** |
| Terminal marginal | `R_h` component of **the same** joint samples for replica k; bucket masses from empirical frequencies of those samples |
| Execution Opportunity | Complete 13-D samples from the **same** replica-k sample stream |
| Coherence | Unit test: per sealed issuance, terminal bucket masses = `R_h` marginal of joint samples within `1e-12` |
| Artifact schema (≤64KiB / replica) | Sealed via **§2.11.3** `replica_artifact_digest_k` fields (edges, pool digests, `bootstrap_root_k`, counts) |
| model_transform_version | `rv-state-conditional-empirical-joint/v1` |
| Parent package seal | `K` replica artifacts + package digest over ordered replica digests; no shared single-pool shortcut |
| Scoring | Same harness protocol; comparable to unconditional `empirical-joint/v1` on common PIT-valid anchors |
| Known-answer | Synthetic DEVELOPMENT with known `bootstrap_root_k` → distinct replica edges; M↑ reduces `mu_k` MC error; `stationary-bootstrap/v1` suite (§2.4.0); SOURCE duplicate → `SOURCE_CORPUS_DUPLICATE_ANCHOR`; bootstrap multiplicity preserved |
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

## 5. PostgreSQL storage-scale test (WP-FORECAST-V2 DoD; C8 exact worst-case)

**Runtime:** CI-pinned PostgreSQL major (record `server_version` in receipt).

### Relation cardinality classification

| Relation | Category | Worst-case count basis |
|----------|----------|------------------------|
| `trader_forecast_bundle_v2` | **PER COMPLETE BUNDLE** | 1 row / bundle |
| `trader_forecast_v2` | **PER COMPLETE BUNDLE** | 2 rows / bundle (terminal + execution) |
| `trader_forecast_outcome_v2` | **PER COMPLETE BUNDLE** | 2 rows / bundle (one per forecast) |
| `trader_forecast_calibration_observation_v2` | **PER COMPLETE BUNDLE** | 2 rows / bundle (one per forecast role) |
| `trader_forecast_scenario_v2` | **PER TERMINAL FORECAST** | 7 rows / bundle (Human-ratified 7-bucket grid; terminal forecast only) |
| `trader_forecast_target_definition_v2` | **FIXED PER PACKAGE** | 2 target definitions / admitted package: `TERMINAL_RETURN` (`DISCRETE_SCENARIO`) + `EXECUTION_OPPORTUNITY` (`SAMPLE_ENSEMBLE`) |
| `trader_forecast_target_bucket_v2` | **FIXED PER TARGET DEFINITION (DISCRETE_SCENARIO only)** | **7 rows TOTAL** per `(symbol,h)` package/cell — **Terminal only**; **0** EO bucket rows (`SAMPLE_ENSEMBLE` has no discrete buckets) |
| `trader_forecast_predictive_package_v2` | **FIXED PER PACKAGE** | 1 row / admitted package |
| `trader_forecast_predictive_package_target_v2` | **FIXED PER PACKAGE** | 2 binding rows / package |
| `trader_forecast_replica_artifact_v2` | **FIXED PER PACKAGE** | `K_max = 50` rows × 65536 bytes each |
| Research/pattern/knowledge tables (`0130`–`0137`) | **FIXED GLOBAL / OUT OF SCOPE** | Not included in bundle projection |

**Target representation semantics (D5 — reconciled with V2 DDL):**

| Target role | `representation_kind` | Bucket rows in `trader_forecast_target_bucket_v2` |
|-------------|----------------------|---------------------------------------------------|
| `TERMINAL_RETURN` | `DISCRETE_SCENARIO` | **7** (Human-ratified quantile grid) |
| `EXECUTION_OPPORTUNITY` | `SAMPLE_ENSEMBLE` | **0** — 13-D generative distribution; **no fabricated discrete buckets** |

Per `(symbol,h)` active package/cell fixed rows: **2** target definitions + **7** target-bucket rows + package/bindings/replicas (PHASE 2). **Do not** multiply target-definition buckets per Forecast bundle.

**PHASE 1 proportional rows (unchanged — per-Forecast scenarios ≠ target-definition buckets):** 1 bundle + 2 forecasts + 2 outcomes + 2 calibration + **7 terminal scenario rows** = **14** proportional rows/bundle (`trader_forecast_scenario_v2` attaches to terminal Forecast only).

**Enumerated surfaces in `B0` / `B1` / projection:** all Forecast V2 tables above + their indexes + TOAST for bytea/json fields; RLS policies excluded from byte measurement.

### PHASE 0 — EMPTY

Migrate clean; `B0 = Σ pg_total_relation_size(relid)` over enumerated V2 Forecast relations (tables + indexes + TOAST).

### PHASE 1 — COMPLETE BUNDLES (exact worst-case)

`N = 200_000` complete bundles. Each bundle inserts **exactly**:

- 1 × `trader_forecast_bundle_v2`
- 2 × `trader_forecast_v2`
- 2 × `trader_forecast_outcome_v2`
- 2 × `trader_forecast_calibration_observation_v2`
- 7 × `trader_forecast_scenario_v2` (terminal forecast; 7 scenarios — not fewer)

`VACUUM (ANALYZE)`; `CHECKPOINT`; measure `B1`.

`bytes_per_complete_bundle = (B1 - B0 - package_fixed_contribution) / N`

**FAIL if:** any bundle uses fewer than 7 scenarios; any per-sample table exists; `bytes_per_complete_bundle > 4096`.

### PHASE 2 — PACKAGE FIXED (measured separately)

Fresh DB; insert worst-case active package set:

- 4 cells (2 symbols × 2 primary horizons) × 1 admitted package each
- `K_max = 50` replica artifacts × 65536 bytes = **`3_276_800` bytes** replica payload per package (exact; no unexplained +2 slots)
- **7** target-bucket rows (Terminal `DISCRETE_SCENARIO` only) + **2** target definitions + package/bindings per cell

Measure `package_fixed_contribution` (includes replica bytea TOAST). **Separate named overhead budget** (indexes/metadata slack) MAY be recorded in receipt but MUST NOT be labeled as unexplained “raw artifact margin.”

### PHASE 3 — HOT/CHECKPOINT

FHV harness proves checkpoint bytes independent of N bundles.

### Projection

`TOTAL_PROJECTED = 12_625_920 × bytes_per_complete_bundle + package_fixed_contribution + enumerated_fixed_V2_other`

where `enumerated_fixed_V2_other` is receipt-enumerated global/research metadata (not bundle-proportional).

**FAIL if:** `TOTAL_PROJECTED > 100 GiB`; hot/checkpoint scales with N; O(S²) scorer present.

---

## 6. Human gates remaining after plan approval

| Gate | Owner | Blocks |
|------|-------|--------|
| Plan approval | Human | `/implement` start |
| H3 K/M + α_epi=0.10 | Human | capital eligibility — ratifies **selected already-evaluated** `(replica_root_family, K_config, M_config, alpha_epi_config)` candidate digests (§2.10 F1+F2); does **not** block pre-H3 stochastic-family or candidate identity construction |
| Target grid `HUMAN_RATIFIED_CAPITAL` | Human | capital terminal forecasts |
| `HUMAN_FHV_EXECUTABLE_POLICY_V1` | Human | STAGE-B / WF_ECONOMIC; seals `executable_policy_digest`; **before WF_ECONOMIC evidence** (§1.25 C6 path A/B) |
| `HUMAN_ECONOMIC_UTILITY_ACCEPTANCE_V1` | Human | STAGE-B numeric rule; **before WF_ECONOMIC evidence** |
| OG-HOST-QUAL runtime tuple | Measured | authoritative replay |
| OG-DATA-RECEIPTS | Measured | Control Replay |
| OG-CONTROL-REPLAY | Measured | holdout path |
| OG-SCI-PACKAGE STAGE-A (WF_PREDICTIVE) / Position Reassessment / HUMAN_FHV / STAGE-B (WF_ECONOMIC) | Measured + Human | `FROZEN_SELECTED_PACKAGE_READY` |
| OG-HOLDOUT-AUTH | Human one-shot | FHV (requires CONTROL_REPLAY=PASS **and** FROZEN_SELECTED_PACKAGE_READY) |
| OG-FHV (DEE-541) | Measured | blind holdout; **identical** `executable_policy_digest` |
| Squash merge | Human | production tip |
| `BLOCKING_PRE_HOLDOUT_POSITION_REASSESSMENT_INTEGRATION` | Human (future Linear under DEE-512) | before WF_ECONOMIC / holdout; NOT post-DEE-541 |

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
| `StrategySignal.maxRisk` quarantined on V2 (B4) | ✓ (§1.20, §1.23) |
| Hypothesis confidence firewall (P3) | ✓ (§1.21) |
| `stationary-bootstrap/v1` literal + executable (B1) | ✓ (§2.4.0) |
| Bootstrap output length exactly n (B1) | ✓ (§2.4.0) |
| Restart probability exactly 1/L via UNBIASED_INT(L)==0 (B1) | ✓ (§2.4.0) |
| Circular continuation + wrap specified (B1) | ✓ (§2.4.0) |
| `WAIA_RANDOM_BLOCK_V1` 8-byte domains + 32-byte roots (B2) | ✓ (§2.6: EPIBOOT1, ALEDRAW1, SCORECRN1) |
| No uint32 seed where 32-byte root required (B2) | ✓ (§2.4.1, §2.6) |
| SOURCE duplicates fail closed; bootstrap multiplicity valid (B3) | ✓ (§2.4.2) |
| Epistemic K = bootstrap refits; M = aleatoric (E1) | ✓ (§2.4.1) |
| Canonical pool order by resample_position_ordinal (B3) | ✓ (§2.4.2) |
| One sizing/allocation authority chain (B4) | ✓ (§1.23) |
| K/M notional grid ≠ FHV sizing (B4) | ✓ (§1.23, WP-EXECOPP-QUAL) |
| WALK_FORWARD STAGE-B ≡ blind FHV `executable_policy_digest` (B5) | ✓ (§1.15, §1.24) → **WF_ECONOMIC** surface |
| Guardian exact enabled/disabled once policy frozen — never “optional” (B5) | ✓ (§1.22, §1.24) |
| Early Guardian exit cannot rewrite scientific Forecast target (B5) | ✓ (§1.22) |
| Complete betainc-lentz/v1 recurrence (N1) | ✓ |
| Student-t5 CDF limits F(-∞)=0, F(0)=0.5, F(+∞)=1 | ✓ |
| Full-joint EXECUTOR_READY challenger | ✓ `rv-state-conditional-empirical-joint/v1` |
| Terminal = exact R_h marginal of same joint package | ✓ |
| HAR not falsely executor-ready | ✓ |
| Guardian FHV-v1 vs mature Position Reassessment (G1) | ✓ (§1.22) |
| Scientific valuation ≠ FHV executable policy | ✓ (§1.22, §1.24) |
| No optional/as-needed persistence decisions | ✓ migrations `0110`–`0145` |
| Quantizer not falsely attributed to risk numeric | ✓ (§2.5.1) |
| Complete Cody CALERF algorithm frozen | ✓ |
| One PR topology with honest HPA-7 criterion pass | ✓ |
| Post-merge gates not claimed in PR | ✓ |
| Mature Position Reassessment NOT falsely claimed in DEE-518 | ✓ (§1.22 PRE-HOLDOUT gate) |
| `state.status` remains `draft` | ✓ |
| Root prefix byte lengths exact (C1) | ✓ (§2.6: 16-byte table + hex) |
| Package/Forecast identity DAG acyclic (C2) | ✓ (§2.10) |
| Validation bootstrap `VALBOOT1` byte-exact (C3) | ✓ (§2.6.1) |
| Integer-exact L = min{L: L³≥n} (C3) | ✓ (§2.4.0, §2.6.1) |
| Fixed K; no K_eff; fail-closed pools (C4) | ✓ (§4.1, §2.10) |
| WF_PREDICTIVE ≠ WF_ECONOMIC surfaces (C5) | ✓ (§1.4, §1.19) |
| Human receipts before WF_ECONOMIC evidence (C5) | ✓ (§1.19, §6) |
| Decision payoff ↔ executable policy aligned or explicit gap (C6) | ✓ (§1.25) |
| Position Reassessment PRE-HOLDOUT not post-DEE-541 (C7) | ✓ (§1.22) |
| Storage fixture exact worst-case 14 rows/bundle (C8) | ✓ (§5) |
| Artifact cap `50×65536 = 3_276_800` exact (C8) | ✓ (§1.12, §5) |
| No authority-critical digest placeholders (D1) | ✓ (§2.11) |
| `distribution_semantic_digest` quantizeScale8HalfUp/v1 (D2) | ✓ (§2.5.2) |
| Scoring CRN model-independent byte-exact (D3) | ✓ (§2.7) |
| `trial_identity_digest_32` byte-exact (D4) | ✓ (§2.11.5 `trial-id/v2`) |
| EO has 0 target-bucket rows; 7 Terminal only (D5) | ✓ (§5) |
| PHASE-1 vs PHASE-2 storage rows distinct (D5) | ✓ (§5) |
| `pkg-gen-id/v2` exact field encoding (E1+F2) | ✓ (§2.10) |
| `fcst-gen-id/v1` exact field encoding (E1) | ✓ (§2.10) |
| Top-level identity digest fields `_hex` lowercase (E1) | ✓ (§2.10) |
| `replica-root-family/v1` + nested bootstrap K surface (F2) | ✓ (§2.10) |
| `forecast-sampling-family/v1` + nested aleatoric M surface (F2) | ✓ (§2.10) |
| K/M bind configuration integers; α_epi configuration frozen (F1) | ✓ (§2.10) |
| No H3→generation identity cycle; bootstrap roots pre-H3 (F1) | ✓ (§2.10) |
| H3 binds selected candidate digests; approval does not mutate identity (F1) | ✓ (§2.10, §6, WP-EXECOPP-QUAL) |
| K/M convergence uses common nested surface; not independent seeds (F2) | ✓ (§2.8, §2.10, WP-EXECOPP-QUAL) |
| 4096 anchors per (symbol,h); 16384 unique anchors shared (F2) | ✓ (WP-EXECOPP-QUAL) |
| energy-mc K/M gate uses ALEDRAW1 cube; SCORECRN1 separate (F2) | ✓ (§2.8) |
| pkg-gen / fcst-gen known-answer byte vectors (E1) | ✓ (§2.10) |
| SCORECRN1 `retry_u32 = 0` always; no rejection loop (E2) | ✓ (§2.6, §2.7) |
| UNBIASED_INT unchanged for EPIBOOT1 / ALEDRAW1 / VALBOOT1 (E2) | ✓ (§2.6) |
| Holm rank/index excluded from validation RNG identity (E3) | ✓ (§2.11.5) |
| `comparison_family_id` binds Holm family; `trial-id/v2` byte-exact (E3) | ✓ (§2.11.5) |
| Family order permutation cannot change raw p-values (E3) | ✓ (§2.11.5) |

**D1–D5 + E1–E3 + F1–F2 closure complete. C1–C8 preserved. No unresolved plan blocker identified for Human approval.**

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
| 8 Design | Explicit state machine; sizing authority chain §1.23; Decision excludes Risk allowance and StrategySignal EV/maxRisk; Guardian as subset of FHV_EXECUTABLE_POLICY_V1 |
| 9 Forbidden | Decision reading Risk allowance; StrategySignal→EV/sizing; Risk improving proposals; claiming mature Position Reassessment in FHV-v1 |
| 10 Fail-closed | `KILL_SWITCH_TRIPPED`, `HALT_ACTIVE` |
| 11 KA | trip → CLOSE_ONLY within 1 cycle |
| 12 Tests | ordering regression; kill-fold; strategy-mutation non-effect on EV and desired-size; hypothesis firewall; maxRisk quarantine |
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
| 8 Design | O(K) streaming quantiles over epistemic replicas; SCIENTIFIC_VALUATION vs FHV_EXECUTABLE_POLICY separation; Strategy/Hypothesis/maxRisk non-authority; executable_policy_digest binding |
| 9 Forbidden | Risk in actionability; StrategySignal EV/maxRisk sizing; hypothesis confidence as probability; retuning after economic utility; K/M grid as FHV sizing |
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
| 21 Human | H3; HUMAN_FHV_EXECUTABLE_POLICY_V1; HUMAN_ECONOMIC_UTILITY_ACCEPTANCE_V1 (both before WF_ECONOMIC evidence) |

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
| 1 Purpose | Joint exec-opp qualification + K/M gate; 15 configs on common nested K_max/M_max surface |
| 2 Seams | forecast-v2 exec path, harness |
| 3 Files | `execopp-qualification/*`, km-convergence gate |
| 4 Formulas | energy-mc/v1 from ALEDRAW1 cube (§2.8 F2); K/M §1.14; pkg-gen-id/v2 + replica-root-family §2.10 |
| 5 Time | development anchors only for K/M |
| 6 Inputs | volume QUALIFIED, normalized 13-D; 16384 shared unique anchors |
| 7 Persistence | admission receipt (replica_root_family + selected candidate digests + H3 receipt) |
| 8 Design | nested-prefix evaluation; deterministic selection then H3 |
| 9 Forbidden | independent per-cell seeds; capital authority from digest alone |
| 10 Fail-closed | normalization degenerate |
| 11 KA | nested-prefix regressions §2.10 F2 |
| 12 Tests | admission + km gate + anchor-set identity |
| 13 PIT | dev only for km |
| 14 Replay | admission receipt digest |
| 15 Budget | §K/M compute caps |
| 16 Migration | none |
| 17 Evidence | N/A |
| 18 Dependencies | FORECAST-V2, VOLUME-QUAL, RESEARCH |
| 19 Risk | T1 |
| 20 DoD | receipt emitter |
| 21 Human | H3 ratifies selected `(K_config,M_config,α)` after nested-surface evidence |

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
