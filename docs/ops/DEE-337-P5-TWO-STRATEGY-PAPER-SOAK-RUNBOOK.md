# DEE-337 / NEW-10 — P5 Two-Strategy Paper Soak Runbook

**Linear:** [DEE-337](https://linear.app/deepsense/issue/DEE-337/p5-new-10-48h-paper-soak-2-strategies-closure-report) · **Pipeline:** P5 · **Parent:** [DEE-170](https://linear.app/deepsense/issue/DEE-170/at-e9-paper-trading-epic)

**Purpose:** Operator procedure for the **Post-P5** 48-hour paper soak with **both** registered strategies (`liquidity_sweep_reversal_v0`, `mean_reversion_v0`). Mirrors the evidence structure of [DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md](./DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md) but adds multi-strategy gates from PR #296 (NEW-7..NEW-9).

**Scope:** Evidence path only. Does **not** close Pipeline P5 or promote `dev→main` (that is NEW-11 / DEE-338).

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Git SHA | `origin/dev` ≥ PR #296 merge (`a8509e0` or later) |
| Strategies | Both P4 strategies registered and CDE-gated on soak org |
| Execution mode | **mock only** — no live HTX credentials |
| Host | Long-running VPS (systemd), same posture as DEE-170 soak |
| Runtime DB | SQLite via `pnpm trader:paper:loop` CLI (operator soak path; Cloudflare Cron worker is not a 48h soak substitute) |
| Org + account | Dedicated soak org UUID + `acct-paper-loop` (or documented equivalent) |

---

## Run layout

```text
/root/soak-runs/DEE-337-p5-two-strategy/
  paper-loop-soak-48h.log      # primary stdout evidence
  smoke.log                    # pre-T0 single-cycle validation
  soak-run-metadata.json       # operator T0/T1 tracking
  checkpoint-<utc>.txt         # optional mid-run snapshots
  .data/paper-soak.db          # SQLite state (closed-trade proof)
```

Suggested metadata template:

```json
{
  "run_id": "DEE-337-p5-two-strategy",
  "linear_issue": "DEE-337",
  "git_sha": "<commit-on-host>",
  "organization_id": "<soak-org-uuid>",
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

## Phase 0 — Preflight smoke (required before T0)

```bash
cd /path/to/waia
git fetch origin dev && git checkout <sha>

export DATABASE_URL="file:/root/soak-runs/DEE-337-p5-two-strategy/.data/paper-soak.db"
export WAIA_TRADER_CLI=1

pnpm trader:paper:loop -- \
  --org-id=<soak-org-uuid> \
  --account-key=acct-paper-loop \
  --cycle-prefix=dee-337 \
  --max-cycles=3 \
  2>&1 | tee /root/soak-runs/DEE-337-p5-two-strategy/smoke.log
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

## Phase 1 — T0: start 48h soak

```bash
# systemd unit should invoke unbounded loop (omit --max-cycles)
pnpm trader:paper:loop -- \
  --org-id=<soak-org-uuid> \
  --account-key=acct-paper-loop \
  --cycle-prefix=dee-337 \
  2>&1 | tee -a /root/soak-runs/DEE-337-p5-two-strategy/paper-loop-soak-48h.log
```

Record `t_start_utc` in metadata → `status=running`.

**Cadence:** default 60s bar-close → **≥2,880** `cycle_complete` lines for 48h.

Optional mid-run checkpoint (~24h):

```bash
pnpm trader:paper:soak:analyze -- \
  --log=/root/soak-runs/DEE-337-p5-two-strategy/paper-loop-soak-48h.log \
  --min-hours=24 || true
```

---

## Phase 2 — T1: stop and analyze log evidence

After **≥48h**, stop with SIGTERM (finish current cycle):

```bash
systemctl stop waia-paper-soak-dee-337.service   # or operator SIGTERM
```

Record `t_end_utc`, `status=stopped`.

### Automated log gates

```bash
pnpm trader:paper:soak:analyze -- \
  --log=/root/soak-runs/DEE-337-p5-two-strategy/paper-loop-soak-48h.log \
  --min-hours=48
```

Exit **0** requires:

| Gate | Analyzer field |
|---|---|
| Duration proxy | `meetsCycleDurationThreshold` |
| Both strategies in telemetry | `meetsBothStrategiesObserved` |
| critical = 0 | `meetsCriticalZero` (includes `waia_paper_loop` `cycle_error`) |

Manual critical check (belt-and-suspenders):

```bash
grep '"kind":"paper_loop"' paper-loop-soak-48h.log | grep '"severity":"critical"' | wc -l
```

---

## Phase 3 — Closed-trade proof (DB-side, required for closure)

Log analysis **does not** prove round-trip PnL. Query the soak SQLite book after T1:

1. Export or inspect filled orders for both strategy signal IDs.
2. Confirm **≥1 closed trade per strategy** via `derivePaperStrategyEvaluations` / `buildPaperEvaluationExportDocument` (window = `[t_start_utc, t_end_utc]`).

Integration reference: `tests/integration/trader-paper-p5-multi-strategy.test.ts` (fixture path proving both strategies can round-trip in mock mode).

If market conditions produce **no closed trades** for one strategy during 48h, document honestly in the closure report — **do not** claim PASS. Options:

- Extend soak window with operator approval, or
- Use fixture-replay preflight evidence only for plumbing (insufficient for NEW-10 acceptance — real soak must produce trades or explicit FAIL with reason).

---

## Phase 4 — Closure report

When Phases 1–3 pass, fill [DEE-337-P5-TWO-STRATEGY-PAPER-SOAK-CLOSURE-REPORT.md](./DEE-337-P5-TWO-STRATEGY-PAPER-SOAK-CLOSURE-REPORT.md):

- Set **Verdict: PASS**
- Paste analyzer JSON summary
- Attach closed-trade counts per strategy
- Merge report to `dev` on branch `dee-337-*`

Until then, the closure report remains **PENDING — blocked on 48h wall-clock soak**.

---

## Related

- [DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md](./DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md) — prior single-path soak (pre-P5 multi-strategy)
- [DEE-266-PAPER-LOOP-SOAK-GREP.md](../migrations/DEE-266-PAPER-LOOP-SOAK-GREP.md) — grep reference
- PR #296 — multi-strategy dispatch + `strategy_ids` telemetry
