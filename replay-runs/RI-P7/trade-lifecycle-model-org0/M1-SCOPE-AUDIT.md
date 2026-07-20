# M1 Trade Lifecycle Model — Scope & Implementation Audit

**Auditor:** Composer 2.5 (read-only audit)  
**Date:** 2026-07-04  
**Branch:** `dee-376-m1-trade-lifecycle`  
**Plan:** `.cursor/plans/m1_trade_lifecycle_plan_c2de9011.plan.md`  
**Base:** local `dev` @ `9b5df12` (includes unpushed DEE-375 governance docs; `origin/dev` @ `d4cfc61`)

---

## Verdict

| Item | Result |
|------|--------|
| **Overall** | **FAIL** |
| **MERGE-PATH** | **NEEDS_REWORK** |

**Summary:** Core M1 architecture (types, pairing, persistence, execution/paper/research recorder wiring, M0 regression) is substantively present and the validation chain is green. The one-pass implementation does **not** fully match approved M1 acceptance criteria or Phase 3 deliverables (lifecycle-sourced v2 taxonomy, persisted forced-flat legs, lineage immutability enforcement, partial-fill proof). Linear issue **DEE-376 does not exist** — groom is mandatory before PR. Human phase review gates were skipped; acceptable only as a **process deviation** remediated at PR review, not as a substitute for closing acceptance gaps.

---

## 1. Linear / Governance

### DEE-376 status

| Check | Result |
|-------|--------|
| DEE-376 exists in Linear | **NO** — search returned DEE-375 and unrelated issues only |
| Branch name | `dee-376-m1-trade-lifecycle` (assumes DEE-376; **not linked**) |
| Work committed | **NO** — all M1 changes are local unstaged/untracked |
| Base alignment | Branch includes local `9b5df12` (DEE-375 docs); PR should target `dev` after rebase/sync with `origin/dev` |

### Exact groom requirement before PR

Run `/groom` (or equivalent) to create or confirm the Linear issue **before any PR**:

1. **Issue:** `DEE-376` (or confirm NN if 376 is taken) — title aligned with plan: *M1 — Trade lifecycle model (first-class round-trips + persisted trace)*.
2. **Labels:** exactly one execution label per [`AGENT-EXECUTION-LABELS.md`](../../../docs/waia-governance/AGENT-EXECUTION-LABELS.md) — expect `backend` + program label `program:ai-trader`.
3. **Parent / relation:** link to M0 parent (DEE-364) or `relatedTo` DEE-375 per plan.
4. **Task contract:** Context, Goal, Scope, Do NOT, Acceptance Criteria, Files, Dependencies, Validation commands — must mirror plan acceptance criteria including forced-flat legs and lifecycle taxonomy wiring.
5. **Branch:** `dee-<NN>-m1-trade-lifecycle` (rename branch if NN ≠ 376).
6. **Commits:** `DEE-NN type(scope): subject` on every commit.
7. **PR title:** `DEE-NN feat(trader): M1 trade lifecycle model — persisted round-trips + multi-position lots`
8. **PR body:** Linear link, risk tier T2, test evidence, `./scripts/linear/preflight-pr-governance.sh` pass, explicit list of **known gaps** if merging with deferrals (see §2–3).
9. **Commit scope:** stage **only** M1-scoped files (§4); exclude unrelated untracked replay artifacts.

**Governance alone does not block merge after groom** — but PR must not open until DEE-NN exists and branch/commits reference it.

---

## 2. Phase Compliance

Plan defines three implementation phases with human review stops; implementation delivered all phases in **one pass** (no intermediate commits or review checkpoints).

### Phase 1 — Design + pure model (no DB wiring)

| Deliverable | Plan | Actual | Status |
|-------------|------|--------|--------|
| `DESIGN.md` | Required | `replay-runs/RI-P7/trade-lifecycle-model-org0/DESIGN.md` | ✅ |
| Lifecycle types (`Trade`, `PositionLot`, `TradeLeg`, `LifecycleEvent`) | Required | `lib/trader/lifecycle/trade-lifecycle.types.ts` | ✅ |
| Pure pairing unit tests | Required | `tests/unit/trader-lifecycle-pairing.test.ts` | ✅ |
| **No DB / repo wiring** | Required stop | Migrations + repos added in same pass | ⚠️ Process deviation |

### Phase 2 — Persistence + semantics v2

| Deliverable | Plan | Actual | Status |
|-------------|------|--------|--------|
| `trade-pairing.ts`, `derive-trades-from-fills.ts` | Required | Present | ✅ |
| SQLite + Postgres schema + migrations | Required | `0038`, `0067`, `0068` + schema updates | ✅ |
| Repository + terminal freeze | Required | Both repos; `TradeFrozenError` tested | ✅ |
| `TRADE_LIFECYCLE_SEMANTICS_VERSION_V2` | Required | `trade-lifecycle-semantics.ts` | ✅ |
| Multi-position FIFO tests | Required | Pairing tests | ✅ |
| Partial close tests | Required | Pairing tests | ✅ |
| Partial **fill** tests | Plan acceptance | Not present | ❌ |
| Forced-flat `FORCED_FLAT` leg (unit) | Plan acceptance | Pure functions only; no unit test | ❌ |

### Phase 3 — Runtime wiring + validation

| Deliverable | Plan | Actual | Status |
|-------------|------|--------|--------|
| Execution service lifecycle hook | Required | `execution-service.ts` optional `lifecycleRecorder` | ✅ |
| Paper cycle `SIGNAL_ACCEPTED` + lineage | Required | `paper-cycle-runner.ts`, `signal-to-order.ts` | ✅ |
| Research session recorder wiring | Required | `create-in-memory-research-backtest-session.ts` | ✅ |
| **`research-backtest-runner` lifecycle taxonomy source** | Required | Still uses `derivePaperStrategyEvaluations` fill-walk only | ❌ |
| **`derive-paper-strategy-eval` lifecycle path** | Optional with fallback | Not wired (fallback OK per plan text) | ⚠️ Deferred |
| Dual-run lifecycle vs fill-walk parity assertion | Plan risk mitigation | Not implemented | ❌ |
| `VALIDATION.md` | Required | Present; documents fill-walk parallel path | ✅ |
| M0 forensic + v2 regression | Required | Unchanged tests pass | ✅ |
| Separate `trader-lifecycle-execution-wire.test.ts` | Plan file list | Merged into `trader-lifecycle-repository.test.ts` | ⚠️ Minor |

### Human review gates

| Gate | Plan | Actual |
|------|------|--------|
| Stop after Phase 1 | Human review before Phase 2 | Skipped |
| Stop after Phase 2 | Human review before Phase 3 | Skipped |
| Stop after Phase 3 | Human review before M2 | Skipped |

**Assessment:** Plan allows a **single M1 PR** as the merge unit; phase stops are process gates, not separate PRs. Skipping mid-implementation stops is a **process deviation**, not grounds for rollback **if** human review occurs at PR time and acceptance gaps are closed or explicitly waived. **Does not require NEEDS_PHASE_SPLIT** (splitting by phase would add churn without recovering lost review moments). **Does require NEEDS_REWORK** on acceptance gaps below before merge-ready PR.

---

## 3. Architecture Compliance

### PositionLot vs Trade boundary

| Requirement | Status | Evidence |
|-------------|--------|----------|
| PositionLot = live exposure | ✅ | Types + recorder creates lots on buy fill |
| Trade = round-trip knowledge record | ✅ | Types + `TRADE_OPENED` / close path |
| TradeLeg append-only | ✅ | Schema + repo insert-only for legs |
| Documented in DESIGN.md | ✅ | §3A table |

### Terminal Trade freeze

| Requirement | Status | Evidence |
|-------------|--------|----------|
| `frozenAt` on terminal states | ✅ | Repo + types |
| Updates rejected when frozen | ✅ | `TradeFrozenError` in repository tests |
| Non-terminal freeze rejected | ✅ | `updateTradeOperational` guard |

### Direction-agnostic reserved fields

| Requirement | Status | Evidence |
|-------------|--------|----------|
| §3B schema columns | ✅ | `positionSide`, `instrumentKind`, `hedgeGroupId`, `venue`, `accountKey` in schema + types |
| M1 defaults LONG/SPOT | ✅ | Pairing + DESIGN.md |

### Guardian readiness

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Monitor target = open PositionLot | ✅ | DESIGN §3C |
| Reserved event phases | ✅ | `GUARDIAN_EVALUATED`, `GUARDIAN_EXIT_INTENT` in types |
| `targetLotId?` on PositionLot | ✅ | Types + schema |

### Knowledge / decision / world-state lineage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Nullable lineage columns on Trade | ✅ | Schema + types |
| M1 populate signal/order-available fields | ✅ | Recorder + paper signal-to-order wiring |
| **`assertTradeLineageImmutable` enforced on update** | ❌ | Defined in `lifecycle-repository.types.ts`; **never called** in `updateTradeOperational` |

### M0 guarantees preserved

| Requirement | Status | Evidence |
|-------------|--------|----------|
| `CLOSED_TRADE_*` semantics unchanged | ✅ | M0 re-export preserved in `trade-lifecycle-semantics.ts` |
| Forensic tests | ✅ | `trader-closed-trade-attribution-forensics-m0.test.ts` pass |
| v2 attribution tests | ✅ | `trader-closed-trade-attribution-v2.test.ts` pass |
| v1 backtest path unchanged | ✅ | No changes to v1-only runners |
| Sealed artifact mutation | ✅ | No modifications to sealed vault / replay sealed rows |

### Plan acceptance criteria — gap summary

| Criterion | Status |
|-----------|--------|
| Multi-position FIFO | ✅ |
| Partial close | ✅ |
| Partial fill → partial leg | ❌ Not tested |
| **Forced-flat → persisted `FORCED_FLAT` leg** | ❌ Pure `applyForcedFlatSynthetic` only; not wired through recorder/research window |
| **v2 metrics from lifecycle-sourced taxonomy** | ❌ `VALIDATION.md` admits fill-walk continues; `research-backtest-runner.ts` unchanged |
| Lifecycle trace signal→order→fill→trade | ⚠️ Partial (recorder + events; no end-to-end close integration test) |
| Dual-run parity | ❌ |

---

## 4. File Scope

### Changed / created (M1 in-scope — should be in PR)

**New**

- `lib/trader/lifecycle/` (8 modules + `index.ts`)
- `db/migrations/0038_trader_lifecycle.sql`
- `db/migrations_postgres/0067_trader_lifecycle.sql`
- `db/migrations_postgres/0068_trader_lifecycle_rls.sql`
- `tests/unit/trader-lifecycle-pairing.test.ts`
- `tests/unit/trader-lifecycle-repository.test.ts`
- `replay-runs/RI-P7/trade-lifecycle-model-org0/DESIGN.md`
- `replay-runs/RI-P7/trade-lifecycle-model-org0/VALIDATION.md`
- `replay-runs/RI-P7/trade-lifecycle-model-org0/M1-SCOPE-AUDIT.md` (this file)

**Modified**

- `db/schema.ts`, `db/schema.postgres.ts`
- `db/migrations/meta/_journal.json`, `db/migrations_postgres/meta/_journal.json`
- `lib/trader/execution/execution-service.ts`, `execution-service.types.ts`
- `lib/trader/paper/paper-cycle-runner.ts`, `paper-cycle.types.ts`, `signal-to-order.ts`, `trade-lifecycle-semantics.ts`
- `lib/trader/research/create-in-memory-research-backtest-session.ts`

**Total:** 27 M1-scoped paths (including audit deliverable).

### Unrelated untracked files (must NOT commit)

- `.cursor/tmp/*`
- `.playwright-mcp/*`
- `replay-runs/DEE-178-*`, `replay-runs/DEE-337-*`
- `replay-runs/RI-P7/dee-371-artifact-check/*`
- `replay-runs/RI-P7/signal-attribution-org0-20260703/*`
- Other pre-existing untracked forensic / evidence files in git status

### Sealed artifact mutation

**None detected** in M1 diff scope.

---

## 5. Validation

Full chain executed on branch working tree (2026-07-04):

| Command | Result |
|---------|--------|
| `pnpm lint` | **PASS** (0 errors; 80 pre-existing warnings) |
| `pnpm typecheck` | **PASS** |
| `pnpm test --run` | **PASS** — 2049 passed, 89 skipped |
| `pnpm build` | **PASS** |

Technical validation is green; plan acceptance is not fully satisfied (§2–3).

---

## 6. MERGE-PATH Analysis

| Option | Applicable? | Rationale |
|--------|-------------|-----------|
| **READY_FOR_GROOM_AND_PR** | No | Acceptance gaps (forced-flat persistence, lifecycle taxonomy, lineage immutability, partial-fill proof) remain |
| **NEEDS_PHASE_SPLIT** | No | Single PR was always intended; splitting would not recover skipped review gates |
| **NEEDS_REWORK** | **Yes** | Close gaps or obtain explicit architect waiver documented in PR; groom DEE-NN; commit only M1 files; rebase to current `dev` |
| **BLOCKED** | Partial | Blocked on **Linear groom** until DEE-NN exists; not blocked on CI/validation |

### Recommended rework (minimum before PR)

1. **Governance:** Create/link DEE-376 (or confirmed NN) via `/groom`.
2. **Forced-flat:** Wire research window boundary → lifecycle recorder → persisted `FORCED_FLAT` leg; add unit/integration test.
3. **Taxonomy:** Wire v2 backtest metrics to lifecycle-sourced taxonomy (or dual-run + parity assertion per plan risk section).
4. **Lineage immutability:** Call `assertTradeLineageImmutable` in repository update paths.
5. **Tests:** Partial fill leg; optional separate execution-wire test file per plan.
6. **Commit hygiene:** Single-feature commits referencing DEE-NN; exclude unrelated untracked artifacts.

### Acceptable without rollback

One-pass implementation is **acceptable after-the-fact** for **process** (skipped phase stops) **if** human PR review substitutes for mid-phase gates. It is **not acceptable** to merge **as-is** against plan acceptance without rework or documented waiver on items in §3 gap summary.

---

## Final

```
OVERALL:  FAIL
MERGE-PATH: NEEDS_REWORK
```

Stop.

---

## Rework Addendum (2026-07-04 — Composer 2.5)

Minimum M1 rework applied per audit §6 recommendations.

### 1. Linear / governance

| Check | Result |
|-------|--------|
| DEE-376 created | **YES** — [DEE-376](https://linear.app/deepsense/issue/DEE-376/m1-trade-lifecycle-model-first-class-round-trips-persisted-trace) |
| Branch `dee-376-m1-trade-lifecycle` | **Valid** — no rename required |
| Labels | `backend`, `program:ai-trader` |
| Parent | DEE-364 · relatedTo DEE-375 |
| Status | In Progress |

### 2. Rework items closed

| Item | Status | Evidence |
|------|--------|----------|
| Forced-flat persistence | ✅ | `recordForcedFlatLifecycle` in `lifecycle-recorder.ts`; wired in `research-backtest-runner.ts` v2 |
| No `trader_fills` for forced-flat | ✅ | `FORCED_FLAT` leg uses `fillId: null`, `syntheticId`; repository test |
| Dual-run parity assertion | ✅ | `lifecycle-fill-walk-parity.ts`; called when `lifecycleRecorder` present |
| Lineage immutability enforced | ✅ | `assertTradeLineageImmutable` in SQLite + Postgres `updateTradeOperational` |
| Partial fill → partial leg test | ✅ | `trader-lifecycle-pairing.test.ts` |
| VALIDATION.md updated | ✅ | Documents dual-run behavior |

### 3. Remaining before PR

| Blocker | Notes |
|---------|-------|
| **No commits** | All work still local unstaged/untracked |
| **Rebase to `origin/dev`** | Branch base may include unpushed DEE-375 docs @ `9b5df12` |
| **Commit hygiene** | Stage M1-scoped files only; exclude unrelated replay artifacts |
| **PR governance preflight** | `./scripts/linear/preflight-pr-governance.sh` before PR |
| **Human PR review** | Substitutes for skipped mid-phase review gates |

### 4. Post-rework validation

| Command | Result |
|---------|--------|
| `pnpm lint` | **PASS** (0 errors; 82 warnings, pre-existing + lifecycle) |
| `pnpm typecheck` | **PASS** |
| `pnpm test --run` | **PASS** — 2054 passed, 89 skipped (+5 new lifecycle tests) |
| `pnpm build` | **PASS** |

### 5. Updated verdict

```
OVERALL:  PASS
MERGE-PATH: READY_FOR_GROOM_AND_PR
```

Governance groom complete (DEE-376 exists). Implementation acceptance gaps from initial audit are closed. PR readiness requires commit + push + governance preflight (not performed in this session).

Stop.

