# DEE-337 / NEW-10 — P5 Two-Strategy Accelerated Historical Replay Validation Runbook

**Linear:** [DEE-337](https://linear.app/deepsense/issue/DEE-337/p5-new-10-48h-paper-soak-2-strategies-closure-report) · **Pipeline:** P5 · **Parent:** [DEE-170](https://linear.app/deepsense/issue/DEE-170/at-e9-paper-trading-epic)

**Purpose:** Operator procedure for **Post-P5 Accelerated Historical Replay Validation** with **both** registered strategies (`liquidity_sweep_reversal_v0`, `mean_reversion_v0`) over historical market data. Accelerated Historical Replay Validation is the canonical engineering validation strategy for AI-TRADER MVP. Mirrors the evidence structure of [DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md](./DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md) but adds multi-strategy gates from PR #296 (NEW-7..NEW-9).

**Scope:** Evidence path only. Does **not** close Pipeline P5 or promote `dev→main` (that is NEW-11 / DEE-338).

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Git SHA | `origin/dev` ≥ PR #296 merge (`a8509e0` or later) |
| Strategies | Both P4 strategies registered and CDE-gated on validation org |
| Execution mode | **mock only** — no live HTX credentials |
| Historical data | OHLCV feed sufficient to reproduce realistic conditions for both strategies |
| Runtime DB | SQLite via `pnpm trader:paper:loop` CLI (replay validation path) |
| Org + account | Dedicated validation org UUID + `acct-paper-loop` (or documented equivalent) |

---

## Run layout

```text
/root/replay-runs/DEE-337-p5-two-strategy/
  paper-loop-replay.log         # primary stdout evidence
  smoke.log                     # pre-replay single-cycle validation
  replay-run-metadata.json      # operator window tracking
  checkpoint-<utc>.txt          # optional mid-run snapshots
  .data/paper-replay.db         # SQLite state (closed-trade proof)
```

Suggested metadata template:

```json
{
  "run_id": "DEE-337-p5-two-strategy",
  "linear_issue": "DEE-337",
  "git_sha": "<commit-on-host>",
  "organization_id": "<validation-org-uuid>",
  "account_key": "acct-paper-loop",
  "expected_strategy_ids": [
    "liquidity_sweep_reversal_v0",
    "mean_reversion_v0"
  ],
  "t_start_utc": null,
  "t_end_utc": null,
  "status": "preflight_pending"
}
```

---

## Phase 0 — Preflight smoke (required before replay)

```bash
cd /path/to/waia
git fetch origin dev && git checkout <sha>

export DATABASE_URL="file:/root/replay-runs/DEE-337-p5-two-strategy/.data/paper-replay.db"
export WAIA_TRADER_CLI=1

pnpm trader:paper:loop -- \
  --org-id=<validation-org-uuid> \
  --account-key=acct-paper-loop \
  --cycle-prefix=dee-337 \
  --max-cycles=3 \
  2>&1 | tee /root/replay-runs/DEE-337-p5-two-strategy/smoke.log
```

**Preflight gates (must pass):**

1. At least one `cycle_complete` line with `strategy_ids` containing **both** strategy IDs (comma-separated).
2. Zero lines with `"severity":"critical"` on `kind:"paper_loop"`.
3. At least one `execution_status:"submitted"` in smoke log.

Grep helpers (see also [DEE-266-PAPER-LOOP-SOAK-GREP.md](../migrations/DEE-266-PAPER-LOOP-SOAK-GREP.md)):

```bash
grep '"kind":"paper_loop"' smoke.log | grep '"outcome":"cycle_complete"' | tail -3
grep '"kind":"paper_loop"' smoke.log | grep '"severity":"critical"' | wc -l   # expect 0
grep '"strategy_ids"' smoke.log | grep 'liquidity_sweep_reversal_v0' | head -1
grep '"strategy_ids"' smoke.log | grep 'mean_reversion_v0' | head -1
```

Update metadata: `status=preflight_ready`, record `git_sha`.

---

## Phase 1 — Run Accelerated Historical Replay Validation

Drive the paper bar-close loop from historical OHLCV over a window meaningful for both strategies' horizons. Record `t_start_utc` and `t_end_utc` from the replayed bar timestamps (not wall-clock elapsed time).

```bash
pnpm trader:paper:loop -- \
  --org-id=<validation-org-uuid> \
  --account-key=acct-paper-loop \
  --cycle-prefix=dee-337 \
  2>&1 | tee -a /root/replay-runs/DEE-337-p5-two-strategy/paper-loop-replay.log
```

Record window bounds in metadata → `status=running` then `status=stopped` when complete.

Optional mid-run checkpoint:

```bash
pnpm trader:paper:soak:analyze -- \
  --log=/root/replay-runs/DEE-337-p5-two-strategy/paper-loop-replay.log \
  --min-hours=24 || true
```

---

## Phase 2 — Analyze log evidence

### Automated log gates

```bash
pnpm trader:paper:soak:analyze -- \
  --log=/root/replay-runs/DEE-337-p5-two-strategy/paper-loop-replay.log \
  --min-hours=48
```

Exit **0** requires:

| Gate | Analyzer field |
|---|---|
| Duration proxy (replayed bar span) | `meetsCycleDurationThreshold` |
| Both strategies in telemetry | `meetsBothStrategiesObserved` |
| critical = 0 | `meetsCriticalZero` (includes `waia_paper_loop` `cycle_error`) |

Manual critical check (belt-and-suspenders):

```bash
grep '"kind":"paper_loop"' paper-loop-replay.log | grep '"severity":"critical"' | wc -l
```

---

## Phase 3 — Closed-trade proof (DB-side, required for closure)

Log analysis **does not** prove round-trip PnL. Query the replay SQLite book using the closed-trade evidence CLI (window = `[t_start_utc, t_end_utc]` from `replay-run-metadata.json`):

```bash
pnpm trader:paper:soak:evidence -- \
  --db=file:/root/replay-runs/DEE-337-p5-two-strategy/.data/paper-replay.db \
  --org-id=<validation-org-uuid> \
  --account-key=acct-paper-loop \
  --start-utc=<t_start_utc> \
  --end-utc=<t_end_utc> \
  --out=/root/replay-runs/DEE-337-p5-two-strategy/closed-trade-evidence.json
```

Exit **0** requires **≥1 closed trade per strategy** in the replay window. The JSON artifact includes per-strategy `closedTradeCount` values plus the digest-sealed `exportDocument`.

Integration reference: `tests/integration/trader-paper-p5-multi-strategy.test.ts` (fixture path proving both strategies can round-trip in mock mode).

If the replay window produces **no closed trades** for one strategy, document honestly in the closure report — **do not** claim PASS. Options:

- Extend the replay window with operator approval, or
- Document explicit FAIL with root cause.

---

## Phase 4 — Closure report

When Phases 1–3 pass, fill [DEE-337-P5-TWO-STRATEGY-PAPER-SOAK-CLOSURE-REPORT.md](./DEE-337-P5-TWO-STRATEGY-PAPER-SOAK-CLOSURE-REPORT.md):

- Set **Verdict: PASS**
- Paste analyzer JSON summary
- Attach closed-trade counts per strategy
- Merge report to `dev` on branch `dee-337-*`

Until then, the closure report remains **PENDING — Accelerated Historical Replay Validation not yet executed**.

---

## Related

- [DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md](./DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md) — prior single-path soak (pre-P5 multi-strategy; historical record)
- [DEE-266-PAPER-LOOP-SOAK-GREP.md](../migrations/DEE-266-PAPER-LOOP-SOAK-GREP.md) — grep reference
- PR #296 — multi-strategy dispatch + `strategy_ids` telemetry
