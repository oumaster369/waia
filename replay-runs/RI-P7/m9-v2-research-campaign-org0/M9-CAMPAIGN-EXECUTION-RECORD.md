# M9 Campaign Execution Record

**Purpose:** Traceability summary for operator campaign attempts. Full stdout/stderr is in `m9-campaign-run.log` (local; gitignored per `*.log` policy).

**Final outcome:** `M9_BLOCKED_BY_ACCOUNTING_DEFECT` — CLI exit code `1` on attempt `0.1.6`.

---

## Environment

| Field | Value |
|-------|-------|
| Execution host | Local dev / Execution Server (same repo root as digests) |
| Campaign window (UTC) | 2026-07-05 — multiple retries through ~19:23Z start of final run |
| Merge SHA (build) | `87e5fb83b0961f44185b355115e04a30bc5659f5` (PR #371) |
| Operator package SHA | `a9c416a` (PR #372) |
| Organization | Org-0 `3c50b4e9-1138-43a5-a29f-e65088124cfc` |
| Strategy | `mean_reversion_v0` |
| Symbol / interval | `BTC/USDT` / `1m` |
| Metrics schema | `2.0.0` |
| Guardian exits | `--enable-guardian-exits=1` |
| HTX bars (preflight) | 129602 |

---

## Attempt chronology

| # | Marker in log | Version | Outcome | Blocking error |
|---|---------------|---------|---------|----------------|
| 0 | (initial) | `0.1.1` | Fail | Postgres: `column "max_risk_per_trade_pct" does not exist` (schema drift; fixed before retry) |
| 1 | `RETRY 2026-07-05T13:42:16Z` | `0.1.1` | Fail | `PaperPnLReconciliationError`: sell 0.01 > open 0 |
| 2 | `RETRY 0.1.2` | `0.1.2` | Fail | Duplicate dataset key |
| 3 | `RETRY 0.1.2 dataset suffix` | `0.1.2` | Fail | Campaign digest mismatch (scope included `datasetName`) |
| 4 | `RETRY 0.1.2 dataset suffix v2` | `0.1.2` | Fail | Lifecycle: `no open lot for sell fill` |
| 5 | `RETRY 0.1.3 lifecycle fix` | `0.1.3` | Fail | Postgres `CONNECTION_CLOSED` (transient infra) |
| 6 | `RETRY 0.1.4 kill-switch-cleared` | `0.1.4` | Fail | PnL: sell > open 0 |
| 7 | `RETRY 0.1.5 pnl-ledger-fix` | `0.1.5` | Fail | PnL: sell > open 0 |
| **8** | **`RETRY 0.1.6 orphan-sell-skip`** | **`0.1.6`** | **Fail (final)** | **PnL: sell 0.00866055 > open 0.00731991** |

Authorization for final attempt: `operator-authorization-record.json` (campaign digest `6bcd5792…`, blind digest `d0c6cfcc…`, dataset `m9-v2-research-campaign-org0-0.1.6`).

---

## Artifacts produced

| Expected (success path) | Present |
|-------------------------|---------|
| `m9-campaign-manifest.json` | No |
| `m9-v2-metrics-export.json` | No |
| `m9-lifecycle-trace.json` | No |
| `m9-guardian-reason-sample.json` | No |
| `m9-production-knowledge-asset.json` | No |
| `m9-research-rejection-record.json` | No (failure was crash/reconciliation, not regime gate) |
| `operator-authorization-record.json` | Yes |
| `m9-campaign-run.log` | Yes (local) |

---

## Non-blocker incidents (documented, not rewritten)

- **Schema drift (attempt 0):** Missing `max_risk_per_trade_pct` column — environment corrected; not the architectural conclusion.
- **Digest / dataset hygiene (attempts 2–3):** Operator retry discipline; corrected with version bump + suffixed dataset name.
- **Kill switch (attempt 5 segment):** Active kill switch caused risk rejects; cleared before 0.1.4.
- **Postgres connection drop (attempt 5):** Transient pooler disconnect; retried.

These do not change the official M9 conclusion: **accounting defect blocked completion**.
