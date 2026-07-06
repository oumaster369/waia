# M9 Scope Audit

**Issue:** DEE-384  
**Date:** 2026-07-05

## In scope (Build)

| Item | Files / behavior |
|------|------------------|
| v2 metrics wiring | `research-orchestrator.ts`, `research-backtest-isolation.ts`, `research-backtest-runner.ts` |
| Portfolio config | `research-portfolio-config.ts`, CLI flags |
| Lifecycle trace | Postgres lifecycle recorder in campaign deps; `m9-lifecycle-trace.json` export |
| Guardian evidence | Opt-in `--enable-guardian-exits=1`; `backtest-runner.ts` guardian pass-through |
| M9 campaign CLI | `scripts/trader/m9-v2-research-campaign.ts`, `pnpm trader:m9:campaign` |
| Operator gates | `m9-operator-authorization.ts` |
| Candidate hygiene | `m9-candidate-preflight.ts` — duplicate key prevention |
| Failure vault | Reuse `writeCampaignFailureVaultArtifacts` with `naming: "flat"` |
| Artifacts | This directory: DESIGN, SCOPE-AUDIT, OPERATOR-RUNBOOK, PR-READINESS, VALIDATION template |
| Tests | `tests/unit/trader-research-m9-*.test.ts` |

## Out of scope

| Item | Reason |
|------|--------|
| M8 discovery orchestrator | Explicit forbidden |
| Promotion FSM | M9 proves foundation; no gate transitions |
| Live / paper loop changes | Research uses mock ledger + `executionMode: backtest` |
| New Postgres migrations | Not required — reuses 0064–0066 RI substrate |
| HTX backfill | Operator responsibility post-merge |
| Campaign execution during Build | Execution Server access policy |
| Completion plan `m9` checkbox | Closure recorded in vault; snapshot file not rewritten |

## Risk tier

**T2** — Postgres RI campaign + blind single-use; no live capital, no promotion FSM.

## Dependencies

- M0 v2 metrics taxonomy (DEE-372)
- M3 guardian (DEE-378)
- M4 dynamic SL/TP (DEE-379)
- RI orchestrator (DEE-368 / RI-P7)
- M8 merged (DEE-383) — not activated in M9

## Acceptance (Build PR)

- [x] v2 wired through full orchestrator path
- [x] Portfolio configurable; PAPER_LOOP divergence documented
- [x] Lifecycle + guardian export paths
- [x] Operator authorization gates enforced
- [x] Candidate duplicate preflight
- [x] CI green; no campaign run in Build

## Operator campaign outcome (2026-07-06)

- [x] Operator campaign executed (DEE-385)
- [ ] Success evidence bundle — **not produced** (blocked by accounting defect)
- [x] `VALIDATION.md` finalized with honest blocked outcome
- [x] Forensic + closure artifacts in vault

**Blocker:** `M9_BLOCKED_BY_ACCOUNTING_DEFECT` — see `M9-FORENSIC-REPORT.md`.

**Post-M9 sequence:** `../AI-TRADER-ENGINEERING-STATUS.md`
