# ADR-0025: FHV bounded hot state, streaming economic ledger, and the CI/Execution Server full-corpus boundary

**Status:** Accepted
**Date:** 2026-08-06
**Linear:** DEE-436 (parent DEE-416) — PR #452

## Context

The `fhv idhps full corpus gate` consumed its entire 125-minute step timeout on PR #452 run
`31011816726` (head `8f6298782f11adb5ac69c1402f1caacd1efa53fd`). Forensic analysis of artifact
`8937404026` established a measured, reproducible defect rather than flakiness.

**The run was alive and progressing when it was killed.** It reached 65.689% of the corpus
(4,146,944 of 6,312,960 bars) after 7,373.576 s, committing epoch 414 twenty-nine seconds before
the timeout. Memory was not a factor (RSS 478 MB against a 2.5 GiB cap) and no semantic,
economic, Guardian or reconciliation invariant failed.

**Cumulative checkpoint cost is quadratic in run length.** Each epoch performs a WAL truncate, a
full copy of `session.sqlite` into an exclusive temp file, a streaming SHA-256 over every byte, a
second copy into the epoch bundle, and an fsync — all Θ(current database size). The session
database is the only unbounded growth surface (every other checkpoint file saturates by epoch
100), growing linearly at **3,206,136 bytes per 10,000-cycle epoch (321 bytes/cycle)** from
append-only `trader_orders`, `trader_order_events` and `trader_fills`. Measured consequence:

| Epoch | `session.sqlite` | `checkpointBackupDurationMs` |
|---|---|---|
| 0 | 4,542,464 B | — (probe at 3.4 MB: 32.19 ms) |
| 413 | 1,167,781,888 B | 7,599.017 |
| 414 | 1,171,103,744 B | 7,646.919 |

Cumulative checkpoint time reached 1,597,964 ms — **21.7% of elapsed wall time and rising**.
End-to-end throughput decayed monotonically from ~1,667 cps to ~400 cps, against a canonical
floor of 877.

**Checkpoint cost is not the whole deficit.** Excluding all checkpoint time, the hot path
delivered 4,146,944 cycles in 5,775.612 s = **717.99 cps**, already 18.1% below the 877 floor.
The probe's 1.562x over-prediction decomposes exactly: checkpoint overhead 1.2767x multiplied by
hot-path shortfall 1.2232x equals 1.5617x.

**Nothing could catch it before two hours elapsed.** The GS-13 budget "gate" asserted only that a
JSON fixture literal equalled 400 and that a source file contained two identifier strings, so a
19.1x runtime breach (7,646.9 ms against 400 ms) passed silently. The canonical probe samples
4,509 cycles — 0.071% of the corpus, at the point of minimum state — and extrapolates with a flat
`totalBars / cps` model, so it structurally excludes the failure mode it gates. `MIN_THROUGHPUT_CPS
= 877` is exactly `ceil(6,312,960 / 7,200)`, the arithmetic minimum with zero margin; the probe
passed at 878.232 (+0.14%).

## Decision

**AD-1 — Bounded hot state**

`session.sqlite` retains only state required for deterministic resume: current/open orders,
current positions, frontiers (execution, accounting, identity, evidence), cursors, fencing
generation, bounded reconciliation state, and any other state proven necessary. Its size must be
bounded in run length.

**AD-2 — Streaming economic ledger**

Append-only historical economic records — the `trader_orders` historical ledger,
`trader_order_events`, `trader_fills`, and any other record proven to cause linear database
growth — persist through the existing streaming-evidence / append-only economic-ledger
architecture instead of the repeatedly snapshotted hot-state database.

Economic rows are **not** merely deleted from SQLite. The ledger remains authoritative,
reconstructable, digest-bound, fail-closed, and economically identical to the current canonical
path. Deterministic reconstruction is preserved for fills, orders, positions, exits, PnL, fees,
slippage, HWM, drawdown, accounting sequence, reason codes, source frontier and audit lineage.

**AD-3 — Preserved mechanisms**

Fill idempotency, duplicate prevention, fencing-generation takeover, stale-writer rejection,
typed WAL v2 with fsync, atomic checkpoint publication (temp → rename → fsync, `.ready`, manifest
digests), crash/resume parity, bootstrap and terminal reconciliation,
`authoritativeSemanticDigest`, `auditLineageDigest`, and **all three GS-07 phases
(`frontier_mutation`, `before_guardian`, `before_cycle_complete`) distinct and independently
fail-closed**.

**AD-4 — Migration and retirement discipline**

The change requires an additive, reversible migration or a versioned storage contract, ships
behind a configuration switch defaulting to the current path, and requires a **dual-path parity
proof** — byte-identical terminal economics between the old and new storage paths on the same
bounded fixture — before the old path may be retired.

**AD-5 — Unchanged canonical contracts**

`MIN_THROUGHPUT_CPS = 877`, `MAX_PROJECTED_FULL_CORPUS_RUNTIME_S = 7200` and
`MAX_BATCH_CYCLES = 32` are unchanged and must not be weakened. 1,000 cps remains a non-blocking
engineering target and must never become the canonical blocking floor.

**AD-6 — Checkpoint cost budget**

At 1-GB-equivalent qualification depth, per-10,000-cycle checkpoint duration must be **≤ 400 ms
(blocking)** with an engineering target of **≤ 250 ms**. The budget is enforced against measured
runtime by a cost-model gate, never by a fixture assertion.

**AD-7 — Pre-launch projection headroom**

Growth-aware projected official runtime must be **≤ 6,480 s** before any official Execution Server
full corpus is authorized. This is a pre-launch safety requirement providing 10% headroom; the
canonical terminal acceptance remains ≤ 7,200 s.

**AD-8 — CI / Execution Server boundary**

GitHub pull-request CI blocks on the bounded gate set: lint, typecheck, unit tests, tenant
isolation, structural complexity, GS-07 independent corruption injection, accounting/economic
parity, the checkpoint cost-model gate, durability fault injection, process crash/resume parity,
deep-state stability, the canonical probe with growth-aware projection, the representative
deep-corpus gate, build, e2e, artifact identity, and the release/ceremony validators.

**PR CI no longer executes the official 6,312,960-bar full corpus as a merge-blocking job.** The
capability is not deleted: the script, blocking test, harness and evidence staging all remain and
remain runnable.

Official full-corpus technical qualification moves to the approved Execution Server, after Human
squash merge → release promotion → mandatory back-sync → deployment verification → official
dataset qualification → configuration freeze → deterministic control replay → Human authorization.
It must still satisfy runtime ≤ 7,200 s, `sourceExhausted == true`,
`globalEventSequence == 6312960`, `classification == FULL_HISTORICAL_TECHNICAL_COMPLETION`,
complete identity-bound immutable evidence, and complete economic and accounting output.

**AD-9 — Two distinct readiness states**

`PR452_RECOVERY_READY_FOR_HUMAN_SQUASH_MERGE` requires exact-head bounded CI green including
build and e2e. It **does not** claim the official full corpus has run.
`AI_TRADER_FHV_OBSERVABLE_EXECUTION_SERVER_LAUNCH_PACKET_READY_FOR_HUMAN_AUTHORIZATION` is a
separate, later state. Official FHV completion is later still and must never be claimed by a PR
build.

**AD-10 — Human-only operations**

Merge, release promotion, back-sync, Execution Server deployment or mutation, PRE_AUTH, T4/T4A
execution, official dataset qualification, and the official launch remain HUMAN-ONLY, consistent
with ADR-0023 and `INTEGRATION-BOUNDARY-POLICY.md`.

## Consequences

**Positive**

- Per-epoch checkpoint cost becomes independent of run length, removing the quadratic term.
- A checkpoint regression fails a ten-minute gate instead of a two-hour job.
- PR CI gains a bounded envelope, and `build` and `e2e` become reachable.
- Long-running campaigns run on the plane ADR-0023 designates for them.
- Negative economic results remain first-class evidence (ADR-0010, EVIDENCE-POLICY).

**Negative**

- Reconstructing terminal economics now spans the hot-state database and the streaming ledger, so
  resume and terminal reconciliation carry more surface and require the AD-4 dual-path proof.
- Merge no longer implies the official full corpus has passed; the two readiness states must be
  reported distinctly to avoid overclaiming.
- The Execution Server becomes a prerequisite for official qualification, adding an operational
  dependency to the release chain.

**Rejected alternatives**

- *Base snapshot plus per-epoch WAL increments* — removes the repeated full copy but keeps one
  physical SQLite lineage and adds replay complexity to the resume path. Deferred; AD-1/AD-2 give
  the stronger asymptotic result.
- *Relaxing the runtime contract* — only the Human may alter 877 / 7,200, and the growth law would
  still make runtime unbounded in corpus length. Rejected as a substitute for the architecture fix.
- *Raising the checkpoint interval further* — already attempted (3,997 → 10,000). It reduces
  checkpoint count but each remaining checkpoint still costs Θ(database size), so the quadratic
  term survives.

## Links

- PR [#452](https://github.com/oumaster369/waia/pull/452) — DEE-436 / DEE-416
- [ADR-0010 Strategy Validation Gate](0010-strategy-validation-gate.md) — historical replay proves plumbing, not edge
- [ADR-0021 Deterministic research replay clock and state isolation](0021-deterministic-research-replay-clock-and-state-isolation.md)
- [ADR-0022 Content-bound operator authorization and idempotent dataset lifecycle](0022-content-bound-operator-authorization-and-idempotent-dataset-lifecycle.md)
- [ADR-0023 Execution Server as AI-TRADER-only execution plane](0023-execution-server-ai-trader-only-execution-plane.md)
- [`../ai-trader/AI-TRADER-TARGET-ARCHITECTURE.md`](../ai-trader/AI-TRADER-TARGET-ARCHITECTURE.md) — Execution Server owns long-running campaigns
- [`../waia-governance/INTEGRATION-BOUNDARY-POLICY.md`](../waia-governance/INTEGRATION-BOUNDARY-POLICY.md) — HUMAN-ONLY operations
- [`../../lib/trader/observability/fhv-checkpoint-cost-model.ts`](../../lib/trader/observability/fhv-checkpoint-cost-model.ts) — AD-6 enforcement
- [`../../lib/trader/observability/fhv-growth-law.ts`](../../lib/trader/observability/fhv-growth-law.ts) — AD-7 projection
