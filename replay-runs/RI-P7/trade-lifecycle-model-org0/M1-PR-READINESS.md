# M1 PR Readiness Package

**Generated:** 2026-07-04  
**Branch:** `dee-376-m1-trade-lifecycle`  
**Linear:** [DEE-376](https://linear.app/deepsense/issue/DEE-376/m1-trade-lifecycle-model-first-class-round-trips-persisted-trace)  
**Authority:** `.cursor/plans/m1_trade_lifecycle_plan_c2de9011.plan.md`

---

## 1. Verdict

**PASS**

All mandatory M1 implementation artifacts exist in the working tree. The inclusion manifest is fully classified. Forbidden paths are present as untracked noise but segregated. Scope audit + minimum rework closed all acceptance gaps. Full validation chain and governance preflight pass.

**Staging status:** Single commit created with manifest paths only (see §10).

**Repository status:** **READY_TO_PUSH_AND_OPEN_PR** (after human review; push/PR not performed by agent)

---

## 2. Executive summary

M1 delivers first-class persisted round-trip lifecycle entities with FIFO spot long-only pairing, terminal trade freeze, direction-agnostic schema reservations (§3B–§3E), and optional runtime wiring in execution/paper/research paths. Forced-flat window closes persist as `TradeLegKind.FORCED_FLAT` without creating `trader_fills` rows. v2 research backtest enforces dual-run lifecycle vs fill-walk taxonomy parity when `lifecycleRecorder` is present; fill-walk remains the operational metrics source (M0 preserved).

Production changes are confined to `lib/trader/lifecycle/*`, additive DB migrations, declared wiring files, and lifecycle tests. No strategy logic changes. No sealed artifact mutation. No M2+ scope.

**Human next steps:** review commit → push → open PR to `dev` (squash merge) → move DEE-376 to In Review → human merge.

---

## 3. Linear / governance status

| Check | Result |
|-------|--------|
| Issue | DEE-376 exists |
| Title | M1 — Trade lifecycle model (first-class round-trips + persisted trace) |
| Status | In Progress |
| Labels | `backend`, `program:ai-trader` |
| Parent | DEE-364 |
| Related | DEE-375 |
| Branch name | `dee-376-m1-trade-lifecycle` ✓ |
| Execution label | Single label `backend` (+ program label) ✓ |

---

## 4. Plan synchronization status

| Plan | Status |
|------|--------|
| `m1_trade_lifecycle_plan_c2de9011.plan.md` | `m1-groom`, `m1-phase1`, `m1-phase2`, `m1-phase3` → **completed** (already synchronized) |
| `ai-trader_completion_plan_8d61e4db.plan.md` | M0 / M0.5 **completed**; **M1 pending** (not marked complete — correct until PR merge) |
| Immediate next task | M1 (this PR) |

Canonical M1 plan lives at `/Users/legco/.cursor/plans/m1_trade_lifecycle_plan_c2de9011.plan.md` (gitignored). Execution progress only — no architecture/phase/contract edits.

---

## 5. Scope audit confirmations

| Check | Result |
|-------|--------|
| Branch | `dee-376-m1-trade-lifecycle` ✓ |
| M2+ work | None ✓ |
| Strategy logic changes | None (`lib/trader/intelligence/strategies/*` untouched) ✓ |
| Sealed artifact mutation | None ✓ |
| Unrelated replay artifacts mixed in | None in manifest ✓ |

**Note:** Local branch HEAD (`9b5df12`) includes one commit ahead of `origin/dev` (DEE-375 governance docs post-merge sync). Confirm intentional before push or rebase onto `origin/dev`.

---

## 6. File inclusion manifest (31 paths)

### Lifecycle module (10)

```
lib/trader/lifecycle/derive-trades-from-fills.ts
lib/trader/lifecycle/index.ts
lib/trader/lifecycle/lifecycle-fill-walk-parity.ts
lib/trader/lifecycle/lifecycle-recorder.ts
lib/trader/lifecycle/lifecycle-repository-postgres.ts
lib/trader/lifecycle/lifecycle-repository-sqlite.ts
lib/trader/lifecycle/lifecycle-repository.types.ts
lib/trader/lifecycle/trade-lifecycle-semantics.ts
lib/trader/lifecycle/trade-lifecycle.types.ts
lib/trader/lifecycle/trade-pairing.ts
```

### Execution / paper / research wiring (7)

```
lib/trader/execution/execution-service.ts
lib/trader/execution/execution-service.types.ts
lib/trader/paper/paper-cycle-runner.ts
lib/trader/paper/paper-cycle.types.ts
lib/trader/paper/signal-to-order.ts
lib/trader/paper/trade-lifecycle-semantics.ts
lib/trader/research/create-in-memory-research-backtest-session.ts
lib/trader/research/research-backtest-runner.ts
```

### DB schema / migrations (7)

```
db/schema.ts
db/schema.postgres.ts
db/migrations/0038_trader_lifecycle.sql
db/migrations/meta/_journal.json
db/migrations_postgres/0067_trader_lifecycle.sql
db/migrations_postgres/0068_trader_lifecycle_rls.sql
db/migrations_postgres/meta/_journal.json
```

### Tests (2)

```
tests/unit/trader-lifecycle-pairing.test.ts
tests/unit/trader-lifecycle-repository.test.ts
```

### Replay artifacts (4)

```
replay-runs/RI-P7/trade-lifecycle-model-org0/DESIGN.md
replay-runs/RI-P7/trade-lifecycle-model-org0/VALIDATION.md
replay-runs/RI-P7/trade-lifecycle-model-org0/M1-SCOPE-AUDIT.md
replay-runs/RI-P7/trade-lifecycle-model-org0/M1-PR-READINESS.md
```

### Plan files (external — not committed)

```
.cursor/plans/m1_trade_lifecycle_plan_c2de9011.plan.md   # gitignored; execution progress synced
.cursor/plans/ai-trader_completion_plan_8d61e4db.plan.md # gitignored; M1 remains pending
```

**PR body draft (not staged):** `replay-runs/RI-P7/trade-lifecycle-model-org0/M1-PR-BODY.md`

---

## 7. Files that MUST NOT be included

| Path | Reason |
|------|--------|
| `.cursor/tmp/**` | Scratch / plan backups |
| `.playwright-mcp/**` | UI snapshots — unrelated |
| `replay-runs/DEE-178-bp5-gate/**` | Prior campaign evidence |
| `replay-runs/DEE-337-p5-two-strategy/**` | Prior campaign evidence |
| `replay-runs/RI-P7/dee-371-artifact-check/**` | Optional RI-P7 vault — unrelated to M1 |
| `replay-runs/RI-P7/signal-attribution-org0-20260703/**` | Signal attribution investigation — unrelated |
| `replay-runs/RI-P7/trade-lifecycle-model-org0/M1-PR-BODY.md` | PR body draft for preflight only (optional omit to reduce noise) |

---

## 8. Behavioral confirmations

| Requirement | Confirmed |
|-------------|-----------|
| M0 forensic tests preserved | `trader-closed-trade-attribution-forensics-m0.test.ts` unchanged |
| M0 v2 tests pass | `trader-closed-trade-attribution-v2.test.ts` green |
| Lifecycle parity enforced | `assertLifecycleFillWalkTaxonomyParity` in v2 backtest when recorder wired |
| Forced-flat → `FORCED_FLAT` leg, no fill row | `recordForcedFlatLifecycle` + repository test |
| Terminal Trade freeze | `TradeFrozenError` + repository test |
| Lineage immutability | `assertTradeLineageImmutable` in repo update path + test |
| Unrelated local artifacts excluded | Manifest-only staging |

---

## 9. Validation command results

| Command | Result |
|---------|--------|
| `pnpm lint` | **PASS** (0 errors; 82 warnings pre-existing) |
| `pnpm typecheck` | **PASS** |
| `pnpm test --run` | **PASS** — 2054 passed, 89 skipped |
| `pnpm build` | **PASS** |
| `./scripts/linear/preflight-pr-governance.sh` | **PASS** (see §11) |

---

## 10. Staging manifest command

```bash
git add \
  lib/trader/lifecycle/derive-trades-from-fills.ts \
  lib/trader/lifecycle/index.ts \
  lib/trader/lifecycle/lifecycle-fill-walk-parity.ts \
  lib/trader/lifecycle/lifecycle-recorder.ts \
  lib/trader/lifecycle/lifecycle-repository-postgres.ts \
  lib/trader/lifecycle/lifecycle-repository-sqlite.ts \
  lib/trader/lifecycle/lifecycle-repository.types.ts \
  lib/trader/lifecycle/trade-lifecycle-semantics.ts \
  lib/trader/lifecycle/trade-lifecycle.types.ts \
  lib/trader/lifecycle/trade-pairing.ts \
  lib/trader/execution/execution-service.ts \
  lib/trader/execution/execution-service.types.ts \
  lib/trader/paper/paper-cycle-runner.ts \
  lib/trader/paper/paper-cycle.types.ts \
  lib/trader/paper/signal-to-order.ts \
  lib/trader/paper/trade-lifecycle-semantics.ts \
  lib/trader/research/create-in-memory-research-backtest-session.ts \
  lib/trader/research/research-backtest-runner.ts \
  db/schema.ts \
  db/schema.postgres.ts \
  db/migrations/0038_trader_lifecycle.sql \
  db/migrations/meta/_journal.json \
  db/migrations_postgres/0067_trader_lifecycle.sql \
  db/migrations_postgres/0068_trader_lifecycle_rls.sql \
  db/migrations_postgres/meta/_journal.json \
  tests/unit/trader-lifecycle-pairing.test.ts \
  tests/unit/trader-lifecycle-repository.test.ts \
  replay-runs/RI-P7/trade-lifecycle-model-org0/DESIGN.md \
  replay-runs/RI-P7/trade-lifecycle-model-org0/VALIDATION.md \
  replay-runs/RI-P7/trade-lifecycle-model-org0/M1-SCOPE-AUDIT.md \
  replay-runs/RI-P7/trade-lifecycle-model-org0/M1-PR-READINESS.md
```

**Staged file count:** 31

---

## 11. Governance preflight

```bash
PR_TITLE='DEE-376 feat(trader): M1 trade lifecycle model — persisted round-trips + multi-position lots' \
PR_BRANCH='dee-376-m1-trade-lifecycle' \
PR_BASE='dev' \
./scripts/linear/preflight-pr-governance.sh --body-file replay-runs/RI-P7/trade-lifecycle-model-org0/M1-PR-BODY.md
```

Result: **PASS**

---

## 12. Recommended PR title

```
DEE-376 feat(trader): M1 trade lifecycle model — persisted round-trips + multi-position lots
```

---

## 13. Recommended PR body

See [`M1-PR-BODY.md`](./M1-PR-BODY.md) (copy into PR description at open time).

---

## 14. Human review checklist

- [ ] Confirm branch base vs `origin/dev` (DEE-375 docs commit @ `9b5df12` intentional?)
- [ ] Review additive migrations apply cleanly on dev Postgres + SQLite CI
- [ ] Verify PositionLot vs Trade boundary in `DESIGN.md` matches schema
- [ ] Confirm forced-flat legs never create `trader_fills` (repository test evidence)
- [ ] Confirm M0 forensic + v2 tests still document correct legacy vs repaired semantics
- [ ] Confirm no unrelated `??` paths staged (`git diff --cached --name-only`)
- [ ] Squash merge to `dev` only (not `main`)
- [ ] After merge: mark DEE-376 Done; leave parent plan M1 pending until post-merge sync
- [ ] Do not start M2 until explicit human authorization

---

## 15. Remaining blockers (post-commit)

| Blocker | Owner |
|---------|-------|
| Push to remote | Human |
| Open PR to `dev` | Human |
| Move DEE-376 → In Review | Human |
| Merge | Human only |
| Mark parent plan M1 completed | After merge |

Stop.
