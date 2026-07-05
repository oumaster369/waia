# M9 Design — Full Execution Server v2 Research Campaign

**Linear:** DEE-384  
**Branch:** `dee-384-m9-v2-research-campaign` → `dev`  
**Base SHA:** `0c4d3a3417c3e617ace47c3008fa1c3a0cf0b5a7`

## Goal

Wire and document an operator-authorized Execution Server research campaign that produces a trustworthy **v2 evidence bundle** (deposit-aware metrics, lifecycle trace, optional guardian/exit evidence) using the existing RI orchestrator — without promotion, live trading, or M8 discovery activation.

## Architecture

```text
Preflight (operator) → RI orchestrator (Postgres) → sealed vault artifacts
```

| Layer | Responsibility |
|-------|----------------|
| `research-orchestrator.ts` | Dataset seal, candidate register, validation/WF/blind, evidence |
| `research-backtest-isolation.ts` | Mock ledger isolation per window |
| `research-backtest-runner.ts` | v2 metrics, portfolio, forced-flat, lifecycle parity |
| `m9-v2-research-campaign.ts` | Operator gates, candidate hygiene, vault manifest |
| Vault (`replay-runs/RI-P7/m9-v2-research-campaign-org0/`) | Append-only evidence bundle |

## v2 metrics path

- `metricsSchemaVersion: "2.0.0"` through validation, walk-forward, and blind stages
- Portfolio context from configurable deposit/risk limits (replaces hardcoded 1M USDT default)
- `assertResearchValidationMetricsV2Coherence` — aggregate == sum(byRegime)
- Forced-flat via boundary mark-to-close; lifecycle recorder parity when enabled

## Operator authorization

Two explicit gates (CLI):

1. `--operator-campaign-authorization=<digest>` — required to start pipeline
2. `--operator-blind-authorization=<digest>` — required before blind holdout (single-use)

Digests are SHA-256 of canonical campaign scope JSON. Build agents must not run campaign commands.

## Guardian / M4 exits (opt-in)

When `--enable-guardian-exits=1`:

- M3 guardian + M4 exit engine on research backtest path (mock mode)
- Sample `m9-guardian-reason-sample.json` from validation window

Default **off** to preserve RI-P7 baseline comparability.

## Forbidden

- M8 discovery CLI activation
- Validation-gate FSM / promotion
- Live trading, Worker cron changes
- HTX backfill during Build
- Mutating sealed RI-P7 / dee-371 vault JSON

## Build vs operator boundary

| Phase | Deliverable |
|-------|-------------|
| Build PR | Code, tests, runbook, VALIDATION.md **template** |
| Operator campaign | Filled vault artifacts + VALIDATION.md (post-merge, human-authorized) |

Build merge alone does **not** complete M9.
