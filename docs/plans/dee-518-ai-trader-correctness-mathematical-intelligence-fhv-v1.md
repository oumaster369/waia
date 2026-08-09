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
  nextAction: "Human plan approval (state.status -> approved), then /implement starting WP-CANON"
provenance:
  createdFrom: chat
  gateDRatificationSha: 1f10d4eebce23f92dccb3d550e8dc10812d26a9e
  humanRatificationComment: "DEE-516 HUMAN ARCHITECT RATIFICATION — FINAL AI-TRADER GATE-D PACKAGE APPROVED (2026-08-09)"
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
- Group B: WP-EXEC-ACCT, WP-FEATURE-RV, WP-FHV-STORAGE, WP-VOLUME-QUAL, WP-DATASET-QUAL (after CANON docs if needed)
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
| 0130+ | WP-specific: pattern registry, knowledge checkpoint extensions as needed |

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
  → OG-SCI-PACKAGE (DEE-539) [dev/walk-forward only]
  → OG-HOLDOUT-AUTH (DEE-540) [requires CONTROL_REPLAY=PASS AND FROZEN_SELECTED_PACKAGE_READY]
  → OG-FHV (DEE-541)
```

### 1.16 Reviewability gate

**Predicted:** ~180–250 files, ~15,000–25,000 changed lines (excluding lockfiles/generated). Exceeds soft ~800-line/~20-file guidance.

**Hard split criteria** (`INTEGRATION-BOUNDARY-POLICY.md` §When work must split): independent deployability; different risk tiers; infra vs app; prerequisite for parallel work; **unreviewable diff**; different approval gate; reversible intermediate value.

**Assessment:** Single coherent integration batch with explicit WP sections and incremental commits; correctness spine + intelligence layer are causally coupled (Decision economics requires Forecast V2 + execution repairs). No proven independent deployability boundary. **Verdict: `ONE_PR_ARCHITECTURALLY_VALID`** — retain DEE-518 as sole integration issue. Forced split contingency documented in §1.17 only if Human proves unreviewable at pre-PR.

### 1.17 Forced-split contingency (not triggered)

If Human proves unreviewable: DEE-512 spawns INTEGRATION-A (WP-EXEC-ACCT…WP-CONTROL-REPLAY-AUTH) and INTEGRATION-B (WP-FORECAST-V2…WP-CHALLENGER-TRIALS) as **separate integration issues**, each with own plan/branch/PR. Never two PRs under one DEE-518.

### 1.18 Integration Definition of Done

- All DEE-519…DEE-535 acceptance criteria met
- IC-4 validation green
- Storage-scale test PASS
- No per-sample forecast table
- Canon/docs/ADRs updated (WP-CANON)
- Plan `state.status: integration-ready`
- PR opened to `main` with governance preflight PASS
- Post-merge gates documented open (DEE-536…541)

---

## 2. Frozen mathematical contracts (reference — must not change)

### 2.1 Primary target

`Y^R_{t,h} = log(P_{t+h} / P_t)` for `h ∈ {30, 60}` minutes.

### 2.2 RV (corrected)

`r_i = log(close_i / close_{i-1})`; `realizedVar20m_1m = Σ_{i=1}^{20} r_i²`; `realizedVol20m_1m = sqrt(Σ r_i²)`. No demeaning. No annualization. PIT window `(t-20m, t]`. Missing bar → `UNAVAILABLE`.

### 2.3 Execution Opportunity 13-D vector

`[R_1,R_2,R_3,R_h,R_{h+1},R_{h+2},R_{h+3},V_1,V_2,V_3,V_{h+1},V_{h+2},V_{h+3}]` with `R_k = log(P_{t+k}/P_t)`.

### 2.4 Decision economics

Per replica `k`: `mu_base_k = mean_m Pi_base(a,x_{k,m})`, `mu_lower_k = mean_m Pi_lower(a,x_{k,m})`.

Type-7 quantiles: `EV_base = Q_0.50(mu_base_k)`, `EV_lower = Q_0.10(mu_lower_k)`, `EV_upper = Q_0.90(mu_base_k)`.

`DECISION_ACTIONABLE ⇔ EV_lower > 0` + upstream gates. **No Risk allowance term.**

### 2.5 Quantizer `quantizeScale8HalfUp/v1`

Decode IEEE-754 binary64 to exact rational `(sign, mantissa, exponent2)`; value = `sign * mantissa * 2^exponent2`; multiply by `10^8`; integer HALF_UP (ties away from zero); emit fixed 8-decimal canonical string. Reject non-finite. **Does not use `lib/trader/risk/numeric.ts` multiply/divide truncation.**

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

**Purpose:** Ratify canon amendments required by Gate-D without inventing architecture at implementation time.

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

**Purpose:** Enforce `Forecast → Decision → Risk → Execution` and kill/flatten/HALT fold.

**Current seams:**
- `lib/trader/intelligence/forecast-decision/build-decision-record.ts`
- `lib/trader/risk/risk-engine-service.ts`, `kill-switch-service.ts`, `kill-switch-enforcement.ts`
- `lib/trader/guardian/evaluate-position-guardian.ts`, `map-exit-intent-to-submit-order.ts`
- `lib/trader/guardian/htr-breach-partial-entry-cancellation.ts`

**Design:** Decision record has no Risk-allowance input. Kill fold state machine: `TRIPPED → revoke exposure-increasing allowances → cancel pending entries → CLOSE_ONLY → FLATTEN → RECONCILE → HALT`. Risk verdict set: `APPROVE | APPROVE_CLAMPED | VETO | CLOSE_ONLY | HALT`.

**Forbidden:** Decision consulting downstream Risk allowance; post-HALT emergency trading; exposure increase during residual liquidation.

**Tests:** authority ordering regression; kill-fold integration; CLOSE_ONLY allows protective exits; HALT only after flat + reconcile.

**Dependencies:** WP-EXEC-ACCT.

**Risk:** T1.

**DoD:** Causal chain tests pass; no bypass paths.

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

**DoD:** HAR-RV and baselines can consume `realizedVar20m_1m`.

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

**Design:** Implement migrations 0110–0129 (§1.10). Package-level `bytea` artifacts ≤64KiB/replica. Per-forecast compact seal with `distribution_semantic_digest`. `trader_forecast_predictive_package_target_v2` two-role binding. `quantizeScale8HalfUp/v1` + `WAIA_RANDOM_BLOCK_V1`. No `trader_forecast_exec_sample_v2`. Terminal = deterministic projection of package onto `R_h`.

**Fail-closed:** `FORECAST_DISTRIBUTION_REPLAY_MISMATCH`, `FORECAST_MODEL_ARTIFACT_DIGEST_MISMATCH`, `EXEC_OPP_NORMALIZATION_DEGENERATE_COMPONENT`, `FORECAST_RUNTIME_QUALIFICATION_MISMATCH`.

**Storage test:** PHASE 0–3 protocol (§8 below).

**Dependencies:** WP-CANON, WP-FEATURE-RV.

**Risk:** T1.

**DoD:** Storage-scale integration test PASS; replay determinism tests; bundle completeness triggers.

---

### WP-DECISION-ECON — DEE-528

**Purpose:** Execution-aware conservative Decision economics; fail-closed without admission receipt.

**Current seams:** `build-decision-record.ts`, `forecast-decision-service.ts`, `historical-simulated-exchange.ts`, `cost-model.ts`.

**Design:** O(K) streaming EV over regenerated sample stream. Post-horizon participation-sliced liquidation; residual lower floor 0 USDT in `Pi_lower`. `DECISION_ACTIONABLE` without Risk term. Capital admission consumes external scientific-admission receipt; absent → `DECISION_NON_ACTIONABLE`.

**Dependencies:** WP-FORECAST-V2, WP-EXEC-ACCT, WP-AUTHORITY. **NOT** hard-dep WP-EXECOPP-QUAL (runtime receipt only).

**Risk:** T1.

**DoD:** EV ordering tests; fail-closed without receipt; liquidation mechanics tests.

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

**Gaussian CDF kernel `cdf-erf-cody715/v1`:** Cody ACM TOMS715 ERF coefficients (literal):

```
THRESH = 0.46875, FOUR = 4.0
A = [3.16112374387056560, 1.13864154151050156e2, 3.77485237685302021e2, 3.20937758913846947e3, 1.85777706184603153e-1]
B = [2.36012909523441209e1, 2.44024637934444173e2, 1.28261652607737228e3, 2.84423683343917062e3]
C = [5.64188496988670089e-1, 8.88314979438837594, 6.61191906371416295e1, 2.98635138197400131e2, 8.81952221241769090e2, 1.71204761263407058e3, 2.05107837782607147e3, 1.23033935479799725e3, 2.15311535474403846e-8]
D = [1.57449261107098347e1, 1.17693950891312499e2, 5.37181101862009858e2, 1.62138957456669019e3, 3.29079923573345963e3, 4.36261909014324716e3, 3.43936767414372164e3, 1.23033935480374942e3]
P = [3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1, 1.60837851487422766e-2, 6.58749161529837803e-4, 1.63153871373020978e-2]
Q = [2.56852019228982242, 1.87295284992346047, 5.27905102951428412e-1, 6.05183413124413191e-2, 2.33520497626869185e-3]
```

For |z|≤THRESH: `t=z²`; `erf(z)=z·(A4+t·(A3+t·(A2+t·(A1+t·A0))))/(B3+t·(B2+t·(B1+t·B0)))`. Φ(z)=0.5·(1+erf(z/√2)).

**Student-t5 CDF `student-t5-cdf-betainc/v1`:** For standard t_5 with location 0, scale s: `z=x/s`; `F(z)=0.5+0.5·sign(z)·I_{ν/(ν+z²)}(ν/2,1/2)` where ν=5, `I` = regularized incomplete beta via Lentz continued fraction (max 200 iter, tol 1e-15, fail `CDF_KERNEL_NON_CONVERGENT`).

**Validation protocol:** log score; stationary bootstrap L=ceil(n^(1/3)), B=10000, seed=SHA256(trial_id) mod 2^32; Holm FWER 0.05; common anchor set per (symbol,h,challenger); purge/embargo=h; beat EVERY mandatory baseline.

**Target grid ceremony:** dev quantiles {0.05,0.20,0.40,0.60,0.80,0.95} → 7 buckets; `authority_status=RESEARCH_ONLY` until Human ratified.

**Dependencies:** WP-FORECAST-V2, WP-DATASET-QUAL.

**Risk:** T1.

**DoD:** Bootstrap determinism known-answer; Holm known-answer; CDF kernel vectors vs reference values.

---

### WP-EXECOPP-QUAL — DEE-532

**Purpose:** Joint Execution Opportunity qualification + K/M convergence gate.

**Joint baselines:** `empirical-joint/v1` (unbiased dev anchor index); `marginal-independence/v1` (type-7 empirical inverse CDF per component).

**K/M grid:** K∈{10,20,30,40,50}, M∈{20,40,80} (15 configs); reference (50,80); 4096 anchors/cell = 16384 total; scale grid {0.01,0.05,0.10,0.25,0.50}·C0; ev_rate=EV/notional; relative error denominator max(|ev_rate_ref|,5e-5); 95th-pct max over notionals; thresholds 0.01 EV / 0.02 MC_ES.

**Dependencies:** WP-FORECAST-V2, WP-VOLUME-QUAL, WP-RESEARCH-HARNESS.

**Risk:** T1.

**DoD:** K/M selection receipt; emits scientific-admission receipt for runtime consumption.

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

**DoD:** At least one EXECUTOR_READY challenger integrated with harness; others RESEARCH_ONLY or UNIMPLEMENTED per §4.

---

## 4. MODEL_TRIAL_SPEC registry (DEE-535)

### 4.1 `har-rv-terminal/v1` — **EXECUTOR_READY**

| Field | Specification |
|-------|---------------|
| Target | `Y^R_{t,h}` terminal return, h∈{30,60} |
| Features (PIT) | `logRV_d = log(realizedVar20m_1m aggregated over last h bars)`; `logRV_w = log(sum of realizedVar20m_1m over last 5*h bars)`; `logRV_m = log(sum over last 22*h bars)` — if any component UNAVAILABLE, forecast UNAVAILABLE |
| Model | `log(RV_{t+h}) = β0 + β1·logRV_d + β2·logRV_w + β3·logRV_m` (HAR-RV on variance scale) |
| Location forecast | `μ_{t,h} = 0` (zero-drift location challenger); scale `σ_{t,h} = sqrt(RV_hat_{t+h})` |
| Distribution | Gaussian on `Y^R` with σ from HAR-RV scale (link: `σ_Y = σ_price_level ≈ σ_RV` for small returns — use `σ_Y = min(sqrt(RV_hat), σ_cap)` with `σ_cap = 5 * σ_dev` from development) |
| Fitting | OLS on development partition only per (symbol,h); require n≥1000 rows else UNAVAILABLE |
| Output | Terminal bucket probabilities via `Φ((edge-μ)/σ)` differences on ratified grid |
| Artifact schema | `{β0,β1,β2,β3,σ_cap,fit_digest}` JSON canonical, ≤2KB |
| model_transform_version | `har-rv-terminal/v1` |
| Scores | multiclass log score (harness) |
| Known-answer | synthetic constant-variance series → σ_hat constant |
| Compute budget | O(1) per anchor after rolling sums cached |

### 4.2 `garch11-terminal/v1` — **RESEARCH_ONLY_UNIMPLEMENTED_NONLINEAR_OPTIMIZER_NOT_FROZEN**

GARCH(1,1) requires constrained QMLE with ω>0, α≥0, β≥0, α+β<1 and convergence semantics not executor-frozen in Gate-D. Remains research backlog.

### 4.3 `ordinal-ridge-terminal/v1` — **RESEARCH_ONLY_UNIMPLEMENTED_FEATURE_SET_NOT_PINNED**

Regularized ordinal model requires pinned feature vector version beyond `feature-engine/rv/v2` scope; defer until feature registry frozen.

### 4.4 `joint-locscale-execopp/v1` — **RESEARCH_ONLY_UNIMPLEMENTED_MULTIVARIATE_DENSITY_NOT_FROZEN**

13-D joint density for execution opportunity beyond empirical baselines requires additional Human scientific design.

### 4.5 `dynamical-state-ablation/v1` — **RESEARCH_ONLY** (owned by WP-PATTERN-RESEARCH substrate; not capital)

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
| OG-HOST-QUAL runtime tuple | Measured | authoritative replay |
| OG-DATA-RECEIPTS | Measured | Control Replay |
| OG-CONTROL-REPLAY | Measured | holdout path |
| OG-SCI-PACKAGE | Measured | holdout auth |
| OG-HOLDOUT-AUTH | Human one-shot | FHV |
| Squash merge | Human | production tip |

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
| No per-sample persistence | ✓ |
| Quantizer not falsely attributed to risk numeric | ✓ |
| RNG/scoring stream semantics | ✓ |
| Cody coefficients literal | ✓ |
| Student-t5 kernel specified | ✓ |
| At least one EXECUTOR_READY challenger | ✓ har-rv-terminal/v1 |
| Storage test executable | ✓ |
| One PR topology | ✓ ONE_PR_ARCHITECTURALLY_VALID |
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
| 4 Formulas | fill economics: fee 20bps, half-spread 5bps, impact 10bps on notional (USDT); qty scale 8 HALF_UP via existing risk numeric on economics path only |
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
| 1 Purpose | Causal Decision→Risk→Execution; kill fold |
| 2 Seams | `build-decision-record.ts`, `risk-engine-service.ts`, `kill-switch-service.ts`, `evaluate-position-guardian.ts`, `htr-breach-partial-entry-cancellation.ts` |
| 3 Files | above + authority ordering tests |
| 4 Formulas | N/A (Risk economics-blind) |
| 5 Time | kill fold immediate on trip; flatten until flat |
| 6 Inputs | Decision record, Risk limits, Guardian state |
| 7 Persistence | `trader_kill_switches`, decision/risk audit tables |
| 8 Design | Explicit state machine enum; Decision API excludes Risk allowance |
| 9 Forbidden | Decision reading Risk allowance; post-HALT trading |
| 10 Fail-closed | `KILL_SWITCH_TRIPPED`, `HALT_ACTIVE` |
| 11 KA | trip → CLOSE_ONLY within 1 cycle |
| 12 Tests | ordering regression; kill-fold integration |
| 13 PIT | N/A |
| 14 Replay | deterministic kill sequence |
| 15 Budget | O(1) |
| 16 Migration | none |
| 17 Evidence | N/A |
| 18 Dependencies | WP-EXEC-ACCT |
| 19 Risk | T1 |
| 20 DoD | authority tests green |
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
| 20 DoD | HAR-RV can consume realizedVar20m_1m |
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
| 7 Persistence | qualification receipt immutable JSON |
| 8 Design | lineage proof → QUALIFIED or BLOCKED reason |
| 9 Forbidden | assuming base volume without proof |
| 10 Fail-closed | `HTX_VOLUME_AUTHORITY_BLOCKED_*` |
| 11 KA | synthetic manifest with known unit |
| 12 Tests | receipt schema; fail-closed capital gate |
| 13 PIT | N/A |
| 14 Replay | receipt digest stable |
| 15 Budget | streaming scan |
| 16 Migration | receipt table optional |
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
| 6 Inputs | sealed forecasts, admission receipt optional, C0 not sizing |
| 7 Persistence | decision record economic fields |
| 8 Design | O(K) streaming quantiles; fail-closed w/o receipt |
| 9 Forbidden | Risk in actionability; dev-average EV; probability reweight |
| 10 Fail-closed | `EV_RANGE_INVALID`, `DECISION_NON_ACTIONABLE` |
| 11 KA | ordering EV_lower≤base≤upper |
| 12 Tests | economics unit; liquidation integration |
| 13 PIT | forecasts sealed ≤t |
| 14 Replay | EV deterministic per seal |
| 15 Budget | O(K) memory |
| 16 Migration | decision schema extension |
| 17 Evidence | N/A |
| 18 Dependencies | FORECAST-V2, EXEC-ACCT, AUTHORITY |
| 19 Risk | T1 |
| 20 DoD | fail-closed + mechanics tests |
| 21 Human | H3 before capital |

### A.11 WP-CONTROL-REPLAY-AUTH (DEE-529)

| # | Contract |
|---|----------|
| 1 Purpose | TEST_ONLY Control Replay authority |
| 2 Seams | `fhv-control-replay-execution.ts`, `fhv-execution-purpose.ts` |
| 3 Files | `control-replay-test-authority.ts`, `fhv-control-replay-parity-digest.ts` |
| 4 Formulas | parity digest over normalized surface |
| 5 Time | CONTROL_REPLAY bounded fixture or qualified dataset window |
| 6 Inputs | TEST_ONLY sealed fixture seed |
| 7 Persistence | auth claim + config freeze digest |
| 8 Design | fixtures through real Risk/Execution |
| 9 Forbidden | bypass Risk/Execution; TEST_ONLY in production |
| 10 Fail-closed | `TEST_ONLY_AUTHORITY_REJECTED` |
| 11 KA | two-run parity digest equal |
| 12 Tests | escape prevention; partial fill path |
| 13 PIT | N/A |
| 14 Replay | parity digest |
| 15 Budget | bounded fixture |
| 16 Migration | none |
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
| 16 Migration | trial tables optional |
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
| 16 Migration | 0130+ pattern tables |
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
| 16 Migration | 0131 optional |
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
| 8 Design | har-rv-terminal/v1 EXECUTOR_READY; others deferred |
| 9 Forbidden | hidden lib defaults; menu optimizers |
| 10 Fail-closed | UNIMPLEMENTED families skipped not invented |
| 11 KA | har-rv synthetic |
| 12 Tests | challenger integrates harness |
| 13 PIT | fit boundary |
| 14 Replay | artifact digest |
| 15 Budget | O(1) score per anchor |
| 16 Migration | none |
| 17 Evidence | N/A |
| 18 Dependencies | RESEARCH-HARNESS, FEATURE-RV |
| 19 Risk | T2 |
| 20 DoD | ≥1 challenger EXECUTOR_READY |
| 21 Human | OG-SCI-PACKAGE selection |
