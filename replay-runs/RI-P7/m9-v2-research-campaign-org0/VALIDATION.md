# M9 Validation Record

**Build issue:** DEE-384 · **Operator issue:** DEE-385  
**Status:** **CLOSED — blocked by accounting defect** (`M9_BLOCKED_BY_ACCOUNTING_DEFECT`)  
**Closure date:** 2026-07-06

---

## Campaign metadata

| Field | Value |
|-------|-------|
| Merge SHA on `dev` (build) | `87e5fb83b0961f44185b355115e04a30bc5659f5` (PR #371) |
| Operator package SHA | `a9c416a` (PR #372) |
| Execution host | Local Execution Server (repo root digests) |
| Campaign run date (UTC) | 2026-07-05 (multi-attempt; final run from 19:23Z) |
| Campaign duration | Multi-attempt session (~6h including retries) |
| Operator | Human operator (chat-authorized) |
| Operator authorization | `operator-authorization-record.json` |
| Organization | Org-0 `3c50b4e9-1138-43a5-a29f-e65088124cfc` |
| Strategy | `mean_reversion_v0` |
| Strategy version (final attempt) | **`0.1.6`** |
| Symbol / interval | `BTC/USDT` / `1m` |
| Dataset name (final) | `m9-v2-research-campaign-org0-0.1.6` |
| Metrics schema | `2.0.0` |
| OOS bar count | `20` (default) |
| Guardian exits | enabled (`--enable-guardian-exits=1`) |
| Vault directory | `replay-runs/RI-P7/m9-v2-research-campaign-org0/` |
| CLI exit code | **`1`** (final) |
| Bar count at run (BTC/USDT 1m) | **129602** |

---

## Final validation matrix

### Proven (successfully demonstrated)

| Capability | Evidence |
|------------|----------|
| M9 build wiring merged to `dev` | PR #371 @ `87e5fb8`; unit tests `trader-research-m9-*` |
| Operator authorization gates | Digests verified at CLI preflight; `operator-authorization-record.json` |
| RI orchestrator invocation | Dataset registration, candidate preflight, backtest runner engaged |
| v2 metrics path wired | `metricsSchemaVersion: 2.0.0` on CLI; orchestrator accepted |
| Guardian exits on research path | `--enable-guardian-exits=1`; guardian/strategy telemetry in log |
| CDE + strategy signal path | `CDE_QUALITY_ALLOW_TRADING`, `STRAT_MR_*` counters in log |
| Mock execution + reconciliation | Order state transitions CREATED→FILLED; reconciliation `run_complete` |
| Lifecycle recorder engaged | Lifecycle errors surfaced (desync detected — see forensic report) |
| Campaign failure handling | Retries documented; no sealed JSON mutated post-write |
| Build vs operator boundary | Build PR did not run campaign; operator phase separate (DEE-385) |

### Not proven (blocked exclusively by accounting defect)

| Capability | Blocker |
|------------|---------|
| Full validation window PnL reconciliation | `PaperPnLReconciliationError` |
| Walk-forward completion | Blocked at validation-stage PnL |
| Blind holdout consumption | Never reached; blind not consumed on final attempt |
| `m9-v2-metrics-export.json` (v2 bundle) | Campaign did not complete |
| `m9-lifecycle-trace.json` parity export | Campaign did not complete |
| `m9-guardian-reason-sample.json` | Campaign did not complete |
| `m9-campaign-manifest.json` / PKA | No success bundle |
| Regime coverage gate outcome | Not reached post-PnL |
| Architect acceptance / M10 readiness | Blocked pending PR1 → PR2 → repeat M9 |

---

## Root cause

**Canonical SPOT inventory / position accounting defect.**

`PaperPnLReconciliationError`: sell fill quantity exceeds PnL ledger open quantity. Final failure:

```
sell quantity 0.00866055 exceeds open quantity 0.00731991
```

Precise analysis: **`M9-FORENSIC-REPORT.md`**.

This is **not** a strategy failure, Research Pipeline failure, Feature Engine failure, Chief Decision Engine failure, or Pattern Discovery failure.

---

## Next engineering step (only acceptable recommendation)

1. **PR1 — Canonical Position Ledger**  
2. **PR2 — Spot Lifecycle Hardening**  
3. **Repeat M9** (operator-authorized campaign after PR1 + PR2)

Do **not** start PR1 in this closure task. Approved evolution roadmap must not be modified.

---

## Preflight (operator)

- [x] M9 Build merged to `dev` @ `87e5fb8`
- [x] HTX bars ≥ 129600 confirmed (129602)
- [x] Candidate versions bumped across retries (`0.1.1` → `0.1.6`)
- [x] `WAIA_TRADER_ORG0_ORGANIZATION_ID` set on Execution Server
- [x] Authorization digests verified against scope
- [x] Campaign log captured (`m9-campaign-run.log`; gitignored)
- [x] Explicit operator go/no-go recorded (chat + authorization record)

---

## Authorization record

- [x] `operator-authorization-record.json` present
- [x] Campaign digest matches scope (org, strategy, version, symbol, interval, vault, metrics)
- [x] Blind digest matches scope + `datasetName`
- [x] Digests match values passed on CLI (final attempt `0.1.6`)

---

## Evidence bundle (success path)

Not applicable — campaign did not succeed. No sealed success JSON produced.

---

## Failure bundle

| Artifact | Present | Notes |
|----------|---------|-------|
| `m9-research-rejection-record.json` | No | Not regime gate failure |
| `m9-evolution-cycle-mvp.json` | No | — |
| `m9-campaign-run.log` | Yes | Local; gitignored |
| `M9-CAMPAIGN-EXECUTION-RECORD.md` | Yes | Retry chronology |
| `M9-FORENSIC-REPORT.md` | Yes | Root cause |
| Postgres candidate status | Partial rows for `0.1.1`–`0.1.6` attempts | Inspect on Execution Server |
| Blind consumed | **No** (final attempt) | Blind not reached |

Failure class: **accounting / PnL reconciliation crash** — not early regime, not post-run regime.

---

## PnL reconciliation

| Field | Validation window | Blind window | Notes |
|-------|-------------------|--------------|-------|
| Starting balance (USDT) | Default 1M | — | Not overridden |
| Realized PnL | **Not computed** | **Not reached** | Blocked by reconciliation error |
| Marked PnL (forced-flat) | **Not computed** | — | — |
| Portfolio risk settings | Loaded after schema fix | — | — |

---

## Outcome

| Result | Value | Notes |
|--------|-------|-------|
| Campaign CLI | **fail** | Exit code **1** |
| Blocker | **`M9_BLOCKED_BY_ACCOUNTING_DEFECT`** | Official architectural conclusion |
| Regime gate | **not reached** | Blocked at PnL |
| Blind consumed | **no** | Repeat M9 requires new blind digest |
| Knowledge ID | **none** | No PKA |
| Architect acceptance | **deferred** | After PR1 + PR2 + repeat M9 |
| DEE-384 (build) | **Done** | Merged PR #371 |
| DEE-385 (operator) | **Done (blocked outcome documented)** | Merged PR #372; campaign executed; validation closed |

---

## Cross-links

- Engineering closure: `M9-ENGINEERING-CLOSURE.md`
- Forensic report: `M9-FORENSIC-REPORT.md`
- Execution record: `M9-CAMPAIGN-EXECUTION-RECORD.md`
- Operator ceremony: `M9-OPERATOR-CEREMONY.md`
- Operator runbook: `M9-OPERATOR-RUNBOOK.md`
- M0 v2 forensics: `replay-runs/RI-P7/closed-trade-attribution-forensics-org0/VALIDATION.md`
