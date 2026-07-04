# M0 PR Readiness Package

**Generated:** 2026-07-04  
**Branch:** `dee-372-m0-closed-trade-attribution-forensics`  
**Linear:** DEE-372  
**Authority:** M0 PR Contract — `ai-trader_completion_plan_8d61e4db.plan.md` § "M0 PR Contract"

---

## 1. Verdict

**PASS**

All mandatory M0 implementation and governance artifacts exist in the working tree. The intended PR file set is fully classified. Forbidden paths are present as untracked noise but are clearly segregated. No implementation gaps identified against the approved plan (M0 Phase 1–3 + M0.5).

**Staging status:** No files are currently staged or committed (by design — human commit/PR authorization pending). This document is the **intended staging manifest** for the human operator.

**Repository status:** **`READY_FOR_PR_READINESS_AUDIT`**

---

## 2. Executive summary

M0 repairs closed-trade attribution under explicit semantics versioning (`waia.trader.closed-trade.v2`, metrics schema `2.0.0`) while preserving permanent v1 forensic regression. The branch contains:

- **Phase 1:** forensic test + `FINDINGS.md` (defect documented, no repair)
- **Phase 2:** forced-flat mark-to-close, v2 metric taxonomy, regime gate on `countAttributedRoundTrips`
- **Phase 3:** `VALIDATION.md` with five proofs on a non-sealed fixture
- **M0.5:** dataset/regime coverage audit (`AUDIT.md` + proxy analysis)

Production changes are confined to declared `lib/trader/paper/*` and `lib/trader/research/*` families plus required v1/v2 compatibility shims. No Postgres migrations. No sealed Org-0 artifact mutation. No blind consumption.

**Human next steps:** stage only the manifest paths below → run full validation chain → commit → push → open PR to `dev` (squash merge). Do **not** use `git add -A`.

---

## 3. Files that MUST be included in the M0 PR

### Production code

| Path | Role |
|------|------|
| `lib/trader/paper/derive-paper-pnl.ts` | Forced-flat mark-to-close + fill walk (Phase 2) |
| `lib/trader/paper/derive-paper-strategy-eval.ts` | v2 taxonomy emission (Phase 2) |
| `lib/trader/paper/paper-strategy-eval.types.ts` | `PaperMarkToCloseTrade` types (Phase 2) |
| `lib/trader/paper/trade-lifecycle-semantics.ts` | **New** — semantics version constants (Phase 2) |
| `lib/trader/research/research-validation-metrics-taxonomy.ts` | **New** — taxonomy + coherence assertion (Phase 2) |
| `lib/trader/research/strategy-candidate.types.ts` | v1/v2 metrics types + schema bump (Phase 2) |
| `lib/trader/research/research-backtest-runner.ts` | v2 backtest path + aggregate == sum(byRegime) (Phase 2) |
| `lib/trader/research/regime-coverage.ts` | Gate reads `countAttributedRoundTrips` (Phase 2 / M0.5) |
| `lib/trader/research/parse-research-validation-metrics.ts` | v1/v2 parse union (compatibility) |
| `lib/trader/research/research-backtest-isolation.ts` | v2 schema opt-in (compatibility) |
| `lib/trader/research/research-orchestrator.ts` | v1 default preserved (compatibility) |
| `lib/trader/research/build-research-evidence-export.ts` | v2 export shape (compatibility) |
| `lib/trader/knowledge/build-production-knowledge-asset.ts` | v1 metrics read-path (compatibility) |
| `scripts/trader/audit-dataset-regime-coverage-readonly.ts` | **New** — M0.5 read-only regime analysis (optional script per plan) |

**Postgres migration:** none (not required by plan).

### Tests

| Path | Role |
|------|------|
| `tests/unit/trader-closed-trade-attribution-forensics-m0.test.ts` | **New** — Phase 1 permanent v1 forensic regression (L1) |
| `tests/unit/trader-closed-trade-attribution-v2.test.ts` | **New** — Phase 2 v2 repair tests (H2/H3/determinism) |
| `tests/unit/trader-market-reasoning-assist.test.ts` | v1/v2 compatibility |
| `tests/unit/trader-production-knowledge-asset.test.ts` | v1/v2 compatibility |
| `tests/unit/trader-research-backtest-isolation.test.ts` | v1/v2 compatibility |
| `tests/unit/trader-research-orchestrator-isolation.test.ts` | v1/v2 compatibility |
| `tests/unit/trader-ri-p7-promotion-rehearsal.test.ts` | v1/v2 compatibility |

### Replay artifacts

| Path | Role |
|------|------|
| `replay-runs/RI-P7/closed-trade-attribution-forensics-org0/FINDINGS.md` | Phase 1 forensic report |
| `replay-runs/RI-P7/closed-trade-attribution-forensics-org0/VALIDATION.md` | Phase 3 validation proofs |
| `replay-runs/RI-P7/dataset-regime-coverage-audit-org0/AUDIT.md` | M0.5 regime/dataset audit |
| `replay-runs/RI-P7/dataset-regime-coverage-audit-org0/regime-analysis-proxy.json` | M0.5 quantitative proxy metrics |

### Governance artifacts

| Path | Role |
|------|------|
| `replay-runs/RI-P7/AI-TRADER-COMPLETION-PLAN-SNAPSHOT-BEFORE-M0.md` | Point-in-time plan traceability (PR Contract mandatory) |
| `replay-runs/RI-P7/WORKING_TREE_INVENTORY_BEFORE_M0.md` | Pre-M0 hygiene audit trail (PR Contract mandatory) |
| `replay-runs/RI-P7/m0-completion-audit/M0-COMPLETION-AUDIT.md` | M0 completion audit (recommended) |
| `replay-runs/RI-P7/m0-pr-readiness/M0-PR-READINESS.md` | This package (recommended) |

### Documentation

No separate `docs/` changes are required for M0. All narrative evidence lives under `replay-runs/RI-P7/**` paths above.

---

### Optional — include ONLY with explicit human confirmation

Pre-existing RI-P7 investigation vault (not produced by M0):

```
replay-runs/RI-P7/dee-371-artifact-check/**
replay-runs/RI-P7/signal-attribution-org0-20260703/**
```

**Default recommendation:** omit from M0 PR to keep scope focused on closed-trade attribution repair. Bundle only if operator wants full RI-P7 authority chain versioned in one PR.

**Already tracked in repo (no action needed):**

```
replay-runs/RI-P7/gate0-decision-record-rest-candles.md
```

---

### Intended staging command (human — do not run `git add -A`)

```bash
git add \
  lib/trader/paper/derive-paper-pnl.ts \
  lib/trader/paper/derive-paper-strategy-eval.ts \
  lib/trader/paper/paper-strategy-eval.types.ts \
  lib/trader/paper/trade-lifecycle-semantics.ts \
  lib/trader/research/research-validation-metrics-taxonomy.ts \
  lib/trader/research/strategy-candidate.types.ts \
  lib/trader/research/research-backtest-runner.ts \
  lib/trader/research/regime-coverage.ts \
  lib/trader/research/parse-research-validation-metrics.ts \
  lib/trader/research/research-backtest-isolation.ts \
  lib/trader/research/research-orchestrator.ts \
  lib/trader/research/build-research-evidence-export.ts \
  lib/trader/knowledge/build-production-knowledge-asset.ts \
  scripts/trader/audit-dataset-regime-coverage-readonly.ts \
  tests/unit/trader-closed-trade-attribution-forensics-m0.test.ts \
  tests/unit/trader-closed-trade-attribution-v2.test.ts \
  tests/unit/trader-market-reasoning-assist.test.ts \
  tests/unit/trader-production-knowledge-asset.test.ts \
  tests/unit/trader-research-backtest-isolation.test.ts \
  tests/unit/trader-research-orchestrator-isolation.test.ts \
  tests/unit/trader-ri-p7-promotion-rehearsal.test.ts \
  replay-runs/RI-P7/closed-trade-attribution-forensics-org0/ \
  replay-runs/RI-P7/dataset-regime-coverage-audit-org0/ \
  replay-runs/RI-P7/AI-TRADER-COMPLETION-PLAN-SNAPSHOT-BEFORE-M0.md \
  replay-runs/RI-P7/WORKING_TREE_INVENTORY_BEFORE_M0.md \
  replay-runs/RI-P7/m0-completion-audit/ \
  replay-runs/RI-P7/m0-pr-readiness/
```

---

## 4. Files that MUST NOT be included

| Path | Reason |
|------|--------|
| `.cursor/tmp/**` | PR-body drafts, plan backups, scratch vault — temporary |
| `.playwright-mcp/**` | UI snapshots — unrelated |
| `replay-runs/DEE-178-bp5-gate/evidence-liquidity_sweep_reversal_v0.json` | Prior DEE-178 campaign — unrelated |
| `replay-runs/DEE-178-bp5-gate/evidence-mean_reversion_v0.json` | Prior DEE-178 campaign — unrelated |
| `replay-runs/DEE-337-p5-two-strategy/closed-trade-evidence.json` | Prior DEE-337 campaign — unrelated |
| `/Users/legco/.cursor/plans/**` | Gitignored canonical plan — use in-repo snapshot instead |

**Currently in working tree as `??` — verify excluded before commit:**

```
?? .cursor/tmp/
?? .playwright-mcp/
?? replay-runs/DEE-178-bp5-gate/evidence-*.json
?? replay-runs/DEE-337-p5-two-strategy/closed-trade-evidence.json
```

**Default exclude (optional vault — see §3):**

```
?? replay-runs/RI-P7/dee-371-artifact-check/
?? replay-runs/RI-P7/signal-attribution-org0-20260703/
```

---

## 5. Duplicate or obsolete artifacts

### Duplicates

| Finding | Assessment |
|---------|------------|
| `FINDINGS.md` vs `VALIDATION.md` | **Not duplicates** — Phase 1 forensics vs Phase 3 repair proofs |
| `M0-COMPLETION-AUDIT.md` vs `M0-PR-READINESS.md` | **Not duplicates** — completion audit vs PR packaging manifest |
| `signal-attribution-report.md` + `.json` | **Not duplicates** — human vs machine-readable (optional vault) |
| `AI-TRADER-COMPLETION-PLAN-SNAPSHOT` vs canonical plan | **Not duplicates** — snapshot is point-in-time; canonical plan is gitignored living contract |

**No duplicate artifacts requiring deletion.**

### Obsolete / stale (retain, do not delete)

| Artifact | Note |
|----------|------|
| `WORKING_TREE_INVENTORY_BEFORE_M0.md` records branch `dev` | Historical record from before feature branch creation — **do not "correct"** per plan governance |
| Snapshot frontmatter todos show `completed` overlay | Execution-progress overlay on immutable snapshot — acceptable; canonical plan is SSOT for live progress |
| Missing Track B JSON locally (`track-b-*`, `campaign-manifest.json`) | Referenced in reports but may exist only on Execution Server — **not required** for M0 PR Contract |

**No obsolete M0 artifacts requiring removal from the intended PR set.**

---

## 6. Remaining risks before PR

| Risk | Severity | Mitigation |
|------|----------|------------|
| **`git add -A` accidental staging** | High | Use §3 manifest only; review `git status` before commit |
| **Work uncommitted** | Expected | Human commit after validation chain |
| **Full validation chain not re-run today** | Medium | Run `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` before commit |
| **PR governance preflight** | Medium | `./scripts/linear/preflight-pr-governance.sh` on rendered PR body |
| **Optional vault bundled without review** | Medium | Default omit `dee-371` / `signal-attribution` unless operator confirms |
| **Forced-flat synthetic closes** | Low | Documented; `markedPnl` ≠ promotion `realizedPnl` alone |
| **Sealed Org-0 Postgres rows remain v1** | Low | By design (H1); new campaigns use v2 on new candidates |
| **TM-only campaigns still fail multi-regime gate** | Informational | Documented in M0.5 AUDIT — not an M0 defect |

---

## 7. Approved implementation plan satisfaction

| Milestone | Contract | Satisfied |
|-----------|----------|-----------|
| M0 Phase 1 | Forensics + test + FINDINGS.md | ✓ |
| M0 Phase 2 | v2 semantics + forced-flat + taxonomy + tests | ✓ |
| M0 Phase 3 | VALIDATION.md five proofs | ✓ |
| M0.5 | AUDIT.md regime/gate analysis | ✓ |
| H1 Sealed evidence / versioning | v1 preserved; v2 opt-in; no mutation | ✓ |
| H2 Forced-flat cost model | boundary bar + `applyCostToFill` sell | ✓ |
| H3 Metric taxonomy | explicit fields; aggregate == sum(byRegime) | ✓ |
| H5 Strategy boundary | no strategy/CDE redesign | ✓ |
| H6 Risk controls | no blind/live/campaign | ✓ |
| L1 Forensic history | v1 test permanent | ✓ |
| M0 PR Contract file classification | all mandatory paths present | ✓ |

**Branch satisfies the approved implementation plan for M0 scope.**

---

## 8. Recommended PR title

```
DEE-372 fix(trader): closed-trade attribution semantics v2 + forced-flat mark-to-close
```

Alternate (if emphasizing research metrics):

```
DEE-372 fix(research): v2 validation metrics taxonomy and lifecycle-correct round-trip attribution
```

---

## 9. Recommended PR description outline

```markdown
## Summary

- Repair closed-trade attribution under explicit semantics versioning (`waia.trader.closed-trade.v2`, research metrics schema `2.0.0`).
- Add forced-flat mark-to-close at evaluation window boundary so open positions produce attributable round-trips via `markToCloseTrades` + `markedPnl`.
- Replace ambiguous `tradeCount` overload with explicit v2 taxonomy; enforce aggregate == sum(byRegime).
- Preserve permanent v1 forensic regression test documenting pre-repair defect behavior.
- Add M0.5 dataset/regime coverage audit (CDE never emits STRESS; bar-level vs trade-attributed gate analysis).

## Linear

- DEE-372

## Milestones delivered

- M0 Phase 1: FINDINGS.md + forensic v1 test
- M0 Phase 2: semantics repair + v2 tests
- M0 Phase 3: VALIDATION.md (non-sealed fixture proofs)
- M0.5: AUDIT.md + regime proxy analysis

## Governance

- No sealed Org-0 artifact / Postgres row mutation
- No blind consumption
- No strategy tuning or gate weakening
- v1 default preserved for legacy artifacts; v2 opt-in via `metricsSchemaVersion: "2.0.0"`

## Test plan

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test --run`
- [ ] `pnpm build`
- [ ] `./scripts/linear/preflight-pr-governance.sh` (on rendered body)
- [ ] Confirm v1 forensic test still asserts legacy wrong behavior
- [ ] Confirm v2 tests pass forced-flat + taxonomy coherence

## Artifacts

- `replay-runs/RI-P7/closed-trade-attribution-forensics-org0/FINDINGS.md`
- `replay-runs/RI-P7/closed-trade-attribution-forensics-org0/VALIDATION.md`
- `replay-runs/RI-P7/dataset-regime-coverage-audit-org0/AUDIT.md`

## Out of scope (explicit)

- M1 trade lifecycle model
- Strategy exits / SL-TP / Position Guardian
- Blind re-run or Execution Server campaign
```

---

## 10. Recommended merge strategy

Per [`AGENTS.md`](../../../AGENTS.md) and [`docs/waia-governance/BRANCHING-STRATEGY.md`](../../../docs/waia-governance/BRANCHING-STRATEGY.md):

| Field | Value |
|-------|-------|
| **Base branch** | `dev` |
| **Merge method** | **Squash merge** (feature/fix class) |
| **Who merges** | Human only — agents never merge |
| **Post-merge** | Verify CI green; Linear → Done (if automation configured); do not promote to `main` without release protocol |

---

## 11. Checklist for human PR review

### Content review

- [ ] PR contains only paths from §3 manifest (no `.cursor/tmp`, no DEE-178/DEE-337 evidence)
- [ ] v1 forensic test (`trader-closed-trade-attribution-forensics-m0.test.ts`) unchanged in intent — still asserts pre-repair behavior
- [ ] v2 path is opt-in; default backtest remains schema `1.0.0`
- [ ] FINDINGS.md v1→v2 mapping table present
- [ ] VALIDATION.md contains all five proofs (a–e)
- [ ] M0.5 AUDIT.md present; no CDE/strategy/gate changes in code
- [ ] No Postgres migration files added
- [ ] Optional RI-P7 vault inclusion was a deliberate operator choice (if bundled)

### Validation review

- [ ] `pnpm lint` — PASS
- [ ] `pnpm typecheck` — PASS
- [ ] `pnpm test --run` — PASS
- [ ] `pnpm build` — PASS
- [ ] PR governance preflight — PASS

### Governance review

- [ ] Branch name: `dee-372-m0-closed-trade-attribution-forensics`
- [ ] PR targets `dev` only (not `main`)
- [ ] Commit messages reference DEE-372
- [ ] No secrets in diff
- [ ] Sealed Org-0 investigation vault JSON not mutated (if included, read-only copies only)
- [ ] Squash merge selected at merge time

### Post-merge

- [ ] Confirm Linear DEE-372 → Done
- [ ] Begin M1 on new branch `dee-<NN>-m1-trade-lifecycle` off updated `dev`
- [ ] Do not re-run blind on Org-0 sealed candidates under v2 without operator authorization

---

## Validation — git status (audit time)

**Branch:** `dee-372-m0-closed-trade-attribution-forensics`

```
 M lib/trader/knowledge/build-production-knowledge-asset.ts
 M lib/trader/paper/derive-paper-pnl.ts
 M lib/trader/paper/derive-paper-strategy-eval.ts
 M lib/trader/paper/paper-strategy-eval.types.ts
 M lib/trader/research/build-research-evidence-export.ts
 M lib/trader/research/parse-research-validation-metrics.ts
 M lib/trader/research/regime-coverage.ts
 M lib/trader/research/research-backtest-isolation.ts
 M lib/trader/research/research-backtest-runner.ts
 M lib/trader/research/research-orchestrator.ts
 M lib/trader/research/strategy-candidate.types.ts
 M tests/unit/trader-market-reasoning-assist.test.ts
 M tests/unit/trader-production-knowledge-asset.test.ts
 M tests/unit/trader-research-backtest-isolation.test.ts
 M tests/unit/trader-research-orchestrator-isolation.test.ts
 M tests/unit/trader-ri-p7-promotion-rehearsal.test.ts
?? .cursor/tmp/
?? .playwright-mcp/
?? lib/trader/paper/trade-lifecycle-semantics.ts
?? lib/trader/research/research-validation-metrics-taxonomy.ts
?? replay-runs/DEE-178-bp5-gate/evidence-liquidity_sweep_reversal_v0.json
?? replay-runs/DEE-178-bp5-gate/evidence-mean_reversion_v0.json
?? replay-runs/DEE-337-p5-two-strategy/closed-trade-evidence.json
?? replay-runs/RI-P7/AI-TRADER-COMPLETION-PLAN-SNAPSHOT-BEFORE-M0.md
?? replay-runs/RI-P7/WORKING_TREE_INVENTORY_BEFORE_M0.md
?? replay-runs/RI-P7/closed-trade-attribution-forensics-org0/
?? replay-runs/RI-P7/dataset-regime-coverage-audit-org0/
?? replay-runs/RI-P7/dee-371-artifact-check/
?? replay-runs/RI-P7/m0-completion-audit/
?? replay-runs/RI-P7/m0-pr-readiness/
?? replay-runs/RI-P7/signal-attribution-org0-20260703/
?? scripts/trader/audit-dataset-regime-coverage-readonly.ts
?? tests/unit/trader-closed-trade-attribution-forensics-m0.test.ts
?? tests/unit/trader-closed-trade-attribution-v2.test.ts
```

**Diff stat (tracked modifications):** 16 files, +645 / −42 lines.

**Staging:** nothing staged (no commits per governance task).

---

*End of M0 PR Readiness Package. No implementation performed. No commits. No PR opened.*
