# Working Tree Inventory Before M0 Phase 1

**Generated:** 2026-07-04 (Saturday)  
**Purpose:** Explicit inventory before `closed-trade-attribution-pipeline-forensics-org0` (M0 Phase 1). No artifacts were modified except this file.

---

## Current branch

```
dev
```

**STOP — feature branch required before M0 Phase 1 implementation.**

Recommended branch name (operator to create after `git checkout dev && git pull origin dev`):

```
dee-XXX-m0-closed-trade-attribution-forensics
```

Replace `XXX` with the Linear issue number when assigned (e.g. `dee-372-m0-closed-trade-attribution-forensics`).

---

## Full `git status --short`

```
?? .cursor/tmp/bp-10_launch_execution_plan_e2aa412c.plan.md.bak
?? .cursor/tmp/dee-338-back-sync-pr-body.md
?? .cursor/tmp/dee-338-release-pr-body.md
?? .cursor/tmp/dee-352-hygiene-pr-body.md
?? .cursor/tmp/dee-355-pr-body.md
?? .cursor/tmp/dee-356-pr-body.md
?? .cursor/tmp/imp-u1-implementation-program.plan.md.bak
?? .cursor/tmp/see-a15-vault-test/evolution-cycle-mvp.json
?? .cursor/tmp/see-a15-vault-test/research-rejection-record.json
?? .playwright-mcp/page-2026-06-29T17-11-20-743Z.yml
?? replay-runs/DEE-178-bp5-gate/evidence-liquidity_sweep_reversal_v0.json
?? replay-runs/DEE-178-bp5-gate/evidence-mean_reversion_v0.json
?? replay-runs/DEE-337-p5-two-strategy/closed-trade-evidence.json
?? replay-runs/RI-P7/dee-371-artifact-check/architect-review-package.md
?? replay-runs/RI-P7/dee-371-artifact-check/evolution-cycle-mvp.json
?? replay-runs/RI-P7/dee-371-artifact-check/market-reasoning-proposal.json
?? replay-runs/RI-P7/dee-371-artifact-check/reasoning-context.json
?? replay-runs/RI-P7/dee-371-artifact-check/reasoning-session-audit.json
?? replay-runs/RI-P7/dee-371-artifact-check/research-director-decision.json
?? replay-runs/RI-P7/dee-371-artifact-check/research-director-decision.md
?? replay-runs/RI-P7/dee-371-artifact-check/research-rejection-record.json
?? replay-runs/RI-P7/dee-371-artifact-check/signal-attribution-verdict.json
?? replay-runs/RI-P7/signal-attribution-org0-20260703/S1-postgres-forensics.json
?? replay-runs/RI-P7/signal-attribution-org0-20260703/signal-attribution-report.json
?? replay-runs/RI-P7/signal-attribution-org0-20260703/signal-attribution-report.md
?? replay-runs/RI-P7/WORKING_TREE_INVENTORY_BEFORE_M0.md
```

**Note:** No modified tracked files (`M` / `D`). All listed paths are untracked (`??`) except this inventory file (created by this hygiene pass).

**Approved plan file (reference only — not in `git status`):**

| Path | In repo? | Notes |
|------|----------|-------|
| `/Users/legco/.cursor/plans/ai-trader_completion_plan_8d61e4db.plan.md` | No (user-level Cursor plans) | Composer-hardened M0–M11 plan; authoritative for implementation |
| `waia/.cursor/plans/` | Gitignored (`.gitignore` line 51) | Other local plans exist; not committed by default |

---

## Grouped inventory

### A. Plan files

| Status | Path | One-line purpose | Recommendation |
|--------|------|------------------|----------------|
| (external) | `/Users/legco/.cursor/plans/ai-trader_completion_plan_8d61e4db.plan.md` | Approved AI-TRADER completion plan (M0–M11, Composer 2.5 contract) | **KEEP** locally; **REVIEW** whether to copy a snapshot into `replay-runs/RI-P7/` for PR traceability (repo `.cursor/plans/` is gitignored) |
| ?? | `.cursor/tmp/bp-10_launch_execution_plan_e2aa412c.plan.md.bak` | Backup of BP-10 launch plan | **IGNORE** — temp backup, unrelated to M0 |
| ?? | `.cursor/tmp/imp-u1-implementation-program.plan.md.bak` | Backup of IMP-U1 program plan | **IGNORE** — temp backup, unrelated to M0 |

### B. RI-P7 replay artifacts

| Status | Path | One-line purpose | Recommendation |
|--------|------|------------------|----------------|
| (tracked, clean) | `replay-runs/RI-P7/gate0-decision-record-rest-candles.md` | Gate 0 HTX REST candles GO decision (2026-07-02) | **KEEP** — already in repo; context for Org-0 data path |
| ?? | `replay-runs/RI-P7/dee-371-artifact-check/architect-review-package.md` | SEE-R2 architect review of mean_reversion rejection vault | **INCLUDE IN FUTURE PR** — RI-P7 authority chain |
| ?? | `replay-runs/RI-P7/dee-371-artifact-check/signal-attribution-verdict.json` | Signal Attribution Investigation verdict (shared pipeline failure) | **INCLUDE IN FUTURE PR** — binds M0 scope |
| ?? | `replay-runs/RI-P7/signal-attribution-org0-20260703/signal-attribution-report.md` | Full S1/S2/S3 investigation report | **INCLUDE IN FUTURE PR** |
| ?? | `replay-runs/RI-P7/signal-attribution-org0-20260703/signal-attribution-report.json` | Machine-readable investigation report | **INCLUDE IN FUTURE PR** |
| ?? | `replay-runs/RI-P7/signal-attribution-org0-20260703/S1-postgres-forensics.json` | S1 Postgres forensics (mean reversion baseline) | **INCLUDE IN FUTURE PR** |
| ?? | `replay-runs/RI-P7/WORKING_TREE_INVENTORY_BEFORE_M0.md` | This hygiene inventory | **INCLUDE IN FUTURE PR** — M0 Phase 0 hygiene |

**Missing from working tree (referenced in reports but not present locally):**

- `replay-runs/RI-P7/signal-attribution-org0-20260703/track-b-research-rejection-record.json`
- `replay-runs/RI-P7/signal-attribution-org0-20260703/track-b-evolution-cycle-mvp.json`
- `replay-runs/RI-P7/signal-attribution-org0-20260703/campaign-manifest.json`

These may live on the Execution Server vault only; **REVIEW** before assuming completeness of RI-P7 artifact set.

### C. Research-director / reasoning artifacts

| Status | Path | One-line purpose | Recommendation |
|--------|------|------------------|----------------|
| ?? | `replay-runs/RI-P7/dee-371-artifact-check/research-director-decision.json` | Research Director decision authority for Signal Attribution Investigation | **INCLUDE IN FUTURE PR** |
| ?? | `replay-runs/RI-P7/dee-371-artifact-check/research-director-decision.md` | Human-readable Research Director decision | **INCLUDE IN FUTURE PR** |
| ?? | `replay-runs/RI-P7/dee-371-artifact-check/research-rejection-record.json` | Deterministic rejection record (mean_reversion MULTI_REGIME_COVERAGE_INSUFFICIENT) | **INCLUDE IN FUTURE PR** |
| ?? | `replay-runs/RI-P7/dee-371-artifact-check/evolution-cycle-mvp.json` | Deterministic evolution-cycle MVP (down-regime hypothesis proposal) | **INCLUDE IN FUTURE PR** |
| ?? | `replay-runs/RI-P7/dee-371-artifact-check/reasoning-context.json` | SEE-R2 reasoning context envelope | **INCLUDE IN FUTURE PR** |
| ?? | `replay-runs/RI-P7/dee-371-artifact-check/reasoning-session-audit.json` | Attested live SEE-R2 reasoning session audit | **INCLUDE IN FUTURE PR** |
| ?? | `replay-runs/RI-P7/dee-371-artifact-check/market-reasoning-proposal.json` | Live AI market-reasoning proposal (advisory) | **INCLUDE IN FUTURE PR** |
| ?? | `.cursor/tmp/see-a15-vault-test/evolution-cycle-mvp.json` | Local SEE-A15 vault test fixture | **IGNORE** — dev scratch, not RI-P7 sealed evidence |
| ?? | `.cursor/tmp/see-a15-vault-test/research-rejection-record.json` | Local SEE-A15 vault test fixture | **IGNORE** — dev scratch |

### D. Execution / server / prior campaign artifacts

| Status | Path | One-line purpose | Recommendation |
|--------|------|------------------|----------------|
| ?? | `replay-runs/DEE-178-bp5-gate/evidence-mean_reversion_v0.json` | DEE-178 Strategy Validation Gate paper evaluation export (mean_reversion) | **REVIEW** — related closed-trade theme; prior campaign, not RI-P7 M0 |
| ?? | `replay-runs/DEE-178-bp5-gate/evidence-liquidity_sweep_reversal_v0.json` | DEE-178 gate paper evaluation export (liquidity_sweep) | **REVIEW** — same |
| (tracked) | `replay-runs/DEE-178-bp5-gate/inputs-*.json` | Gate input fixtures (already committed) | **KEEP** |
| ?? | `replay-runs/DEE-337-p5-two-strategy/closed-trade-evidence.json` | DEE-337 two-strategy paper soak closed-trade evidence | **REVIEW** — directly relevant to closed-trade debugging but separate org/runbook |
| (tracked) | `replay-runs/DEE-337-p5-two-strategy/analyzer-output.json` | DEE-337 analyzer output | **KEEP** |
| (tracked) | `replay-runs/DEE-337-p5-two-strategy/replay-*-metadata.json` | DEE-337 replay metadata | **KEEP** |

No Execution Server runtime artifacts (logs, Postgres dumps, campaign stdout) are present in the working tree.

### E. Unrelated or suspicious files

| Status | Path | One-line purpose | Recommendation |
|--------|------|------------------|----------------|
| ?? | `.cursor/tmp/dee-338-back-sync-pr-body.md` | Draft PR body for release back-sync | **IGNORE** — do not commit |
| ?? | `.cursor/tmp/dee-338-release-pr-body.md` | Draft PR body for release promotion | **IGNORE** |
| ?? | `.cursor/tmp/dee-352-hygiene-pr-body.md` | Draft PR body | **IGNORE** |
| ?? | `.cursor/tmp/dee-355-pr-body.md` | Draft PR body | **IGNORE** |
| ?? | `.cursor/tmp/dee-356-pr-body.md` | Draft PR body | **IGNORE** |
| ?? | `.playwright-mcp/page-2026-06-29T17-11-20-743Z.yml` | Playwright MCP page snapshot (WAIA auth UI) | **IGNORE** — unrelated to AI-TRADER M0 |

---

## Explicit warnings

1. **Branch is `dev`.** M0 Phase 1 must not start on `dev` or `main`. Create `dee-XXX-m0-closed-trade-attribution-forensics` first.
2. **No accidental duplicates detected** among `replay-runs/**` untracked files; nothing deleted.
3. **Unrelated to M0/M0.5:** all `.cursor/tmp/*` PR-body drafts, plan `.bak` files, `.playwright-mcp/*`, and SEE-A15 vault test scratch JSON.
4. **Related but separate campaigns:** DEE-178 and DEE-337 closed-trade/gate evidence — useful reference, not part of RI-P7 sealed investigation vault; human decision needed before bundling into the M0 PR.
5. **Approved plan is outside the repo tree** (user `.cursor/plans/`). M0 Phase 1 deliverable `FINDINGS.md` will live under `replay-runs/RI-P7/closed-trade-attribution-forensics-org0/` per plan; consider whether a plan snapshot should be copied into `replay-runs/RI-P7/` for audit trail.
6. **Sealed artifacts:** all RI-P7 investigation JSON/MD listed above are untracked local copies — treat as read-only evidence; do not mutate digests or blind locks during M0.

---

## M0 Phase 1 expected new artifacts (not yet present)

Per `.cursor/plans/ai-trader_completion_plan_8d61e4db.plan.md`:

- `replay-runs/RI-P7/closed-trade-attribution-forensics-org0/FINDINGS.md`
- `tests/unit/*` — forensic reproducing test (asserts current wrong behavior)

---

## Summary recommendations

| Action | Paths |
|--------|-------|
| **INCLUDE IN FUTURE PR** (RI-P7 + hygiene) | All `replay-runs/RI-P7/dee-371-artifact-check/*`, all `replay-runs/RI-P7/signal-attribution-org0-20260703/*`, this inventory file, future M0 FINDINGS.md |
| **REVIEW BEFORE PR** | `replay-runs/DEE-178-bp5-gate/evidence-*.json`, `replay-runs/DEE-337-p5-two-strategy/closed-trade-evidence.json`, missing Track B campaign artifacts, plan snapshot location |
| **IGNORE (do not commit)** | `.cursor/tmp/**`, `.playwright-mcp/**` |

---

*End of inventory.*
