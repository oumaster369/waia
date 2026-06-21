# DEE-178 — Strategy Validation Gate Operator Runbook

**Audience:** the single accountable operator (ADR-0011) executing the Strategy Validation Gate.
**Tooling:** `pnpm trader:gate` (DEE-277 operator runway, CLI) over the DEE-272 service layer.
**Governing canon:** [ADR-0010](../adr/0010-strategy-validation-gate.md) (gate, no thresholds), [ADR-0011](../adr/0011-single-operator-governance-model.md) (immutable audit, cooling-off, explicit confirm, reversible), [ADR-0009](../adr/0009-regulatory-posture.md) (Org-0 only).

> **What this runway is.** It lets you *execute* the gate process: export evidence, assemble a promotion record, request → confirm → (cooling-off) → effective, verify the audit trail, verify version-bound authorization, and demote.
>
> **What this runway is NOT.** It does not decide whether a strategy deserves capital. There is no scoring, ranking, threshold, or auto-approval. **Passing the gate is your written judgment**, recorded immutably. The CLI only enforces *process* and *evidence completeness*.

---

## 0. Hard rules (read first)

1. **Do NOT pass the gate on the 48h mock soak.** That soak proves plumbing only (ADR-0010). The export will print an `INSUFFICIENT_EVIDENCE` warning for mock / no-fill / zero-trade windows. Treat it as a stop sign, not a speed bump.
2. **Absence of evidence = failure**, never neutral (ADR-0010). If you cannot honestly write the three confidence attestations, do not promote.
3. **One accountable operator.** Cooling-off + reversibility + immutable audit are your safety net (ADR-0011). They are load-bearing — do not try to shorten them.
4. **Org 0 only.** No external client capital (ADR-0009). This runway never submits a live order.

---

## 1. Prerequisites

- A paper DB containing real paper evidence for the candidate strategy/strategies over a **meaningful, multi-regime window** (not the 48h plumbing soak).
- `DATABASE_URL` pointing at that paper DB (SQLite).
- The exact running version + commit of the strategy code: capture with `git rev-parse HEAD`.

All commands below are run as `pnpm trader:gate -- <subcommand> --flag=value …`. The `WAIA_TRADER_CLI=1` safety gate is set automatically by the script.

---

## 2. Step-by-step

### Step 1 — Export evidence (read-only)

```bash
pnpm trader:gate -- export \
  --org-id=<orgId> \
  --window-start=2026-06-01T00:00:00.000Z \
  --window-end=2026-06-15T00:00:00.000Z \
  --strategy-signal-ids=<signalA,signalB> \
  --execution-mode=paper \
  --out=./evidence.json
```

The CLI prints a fact summary (execution mode, window, reconciliation status, closed-trade count, no-fill strategies, content digest). **If you see `⚠ INSUFFICIENT_EVIDENCE`, stop and reconsider** — the window is structurally weak. The export is still written (the tool never blocks); the judgment is yours.

### Step 2 — Author the operator inputs

Create `inputs.json`. Every field is required and validated fail-closed (no defaults). `costModel.feesBps` and `costModel.slippageBps` are mandatory **completeness** fields (no silent zero-cost assumption) — they are not a profitability threshold.

```json
{
  "strategyId": "mean_reversion_v0",
  "strategyVersion": "0.1.0",
  "gitCommitSha": "<git rev-parse HEAD>",
  "hypothesis": "Mean reversion edge in range regimes on BTC/USDT spot.",
  "intendedRegime": "RANGE",
  "costModel": { "feesBps": "10", "slippageBps": "25", "notes": "conservative" },
  "failureModes": [
    "regime shift to STRESS -> kill-switch / STOP_TRADING",
    "liquidity vacuum -> max-quote-exposure cap"
  ],
  "reasonCodeDistribution": { "STRAT_MR_ZSCORE_BUY": 42, "DECLINE_REGIME": 18 },
  "confidenceAttestation": {
    "edgeNetOfCosts": "Edge persists net of modeled fees + slippage over the window.",
    "liveTracksPaper": "Live is expected to track paper within tolerance.",
    "downsideRiskBounded": "Every enumerated failure mode maps to a Risk Engine control."
  }
}
```

### Step 3 — Request promotion (→ PENDING_CONFIRM)

```bash
pnpm trader:gate -- request \
  --org-id=<orgId> \
  --actor-id=<operatorUserId> \
  --evidence=./evidence.json \
  --inputs=./inputs.json \
  --idempotency-key=<uuid>
```

The assembler re-verifies the evidence digest and reconciliation cleanliness and fail-closes on tamper/mismatch. Record the printed `recordId` and `stateVersion`. Re-running with the same `--idempotency-key` returns the same record.

### Step 4 — Confirm (→ COOLING_OFF)

```bash
pnpm trader:gate -- confirm \
  --org-id=<orgId> --actor-id=<operatorUserId> \
  --record-id=<recordId> --expected-state-version=<stateVersion>
```

Cooling-off is taken from `TRADER_PROMOTION_COOLING_OFF_MS` (default 15 min). **There is no override flag.** Note the printed `coolingOffEndsAt`.

### Step 5 — Observe cooling-off

```bash
pnpm trader:gate -- status --org-id=<orgId> --record-id=<recordId>
```

Wait until `effectiveEligible=true` / `remainingMs=0`. Use this window to reconsider — cancel if anything is off (Step 5a).

#### Step 5a — Cancel (reversible, pre-effective)

```bash
pnpm trader:gate -- cancel \
  --org-id=<orgId> --actor-id=<operatorUserId> \
  --record-id=<recordId> --expected-state-version=<stateVersion>
```

### Step 6 — Mark effective (→ EFFECTIVE)

```bash
pnpm trader:gate -- effective \
  --org-id=<orgId> --actor-id=<operatorUserId> \
  --record-id=<recordId> --expected-state-version=<stateVersion> \
  --ack="I confirm the paper evidence exceeds the 48h plumbing soak"
```

`effective` is refused until cooling-off has elapsed and requires the exact `--ack` phrase (the explicit-confirmation step, ADR-0011).

### Step 7 — Verify authorization (version-bound, read-only)

```bash
pnpm trader:gate -- authz \
  --org-id=<orgId> --strategy-id=<strategyId> \
  --strategy-version=<strategyVersion> --probe-version=<wrongVersion>
```

`authorized=true` only for the exact effective version; the probe (wrong version) must print `authorized=false`. This proves version drift cannot ride an old authorization.

### Step 8 — Verify the immutable audit trail

```bash
pnpm trader:gate -- audit --org-id=<orgId> --record-id=<recordId>
```

Confirm the ordered chain: `trader.strategy_promotion.requested → …confirmed → …effective` with your actor id and timestamps.

### Step 9 — Demote if required (reversible)

```bash
pnpm trader:gate -- demote \
  --org-id=<orgId> --actor-id=<operatorUserId> \
  --strategy-id=<strategyId> --expected-state-version=<stateVersion> \
  --reason="<why>"
```

Demotion revokes the effective record; `authz` then returns false. **Drill this at least once before relying on it in anger.**

---

## 3. Governance notes

- The CLI writes promotion/audit rows **only via the service**, which appends an immutable audit entry on every transition. Never edit the DB directly.
- `--cooling-off-ms` is intentionally not a flag. Any unknown flag is rejected.
- This runbook + the CLI prove the gate **process** is executable. They do **not** complete DEE-178, M7.5, or authorize live trading. Live-enable (Org-0, capped, admin-gated) is a separate AT-E10 / M9 action.
