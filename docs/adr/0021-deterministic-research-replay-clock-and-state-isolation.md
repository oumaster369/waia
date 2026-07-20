# ADR-0021: Deterministic Research Replay Clock & State Isolation

**Status:** Accepted (PR1 implementation)
**Date:** 2026-07-08
**Linear:** DEE-397

## Context

The Canonical Pre–Repeat-M9 Remediation Strategy identified that the research/backtest
replay path (`runResearchValidationBacktest`, `runResearchPipelinePostgres` and the M9 v2
research campaign script) was not provably deterministic:

1. `nowMs()` in the campaign script and the in-memory research session builder defaulted
   to `Date.now()`, and the mock exchange connector defaulted to `Date.now()` for order
   and fill timestamps when no clock was injected. Two replays of the same fixture bars,
   run at different wall-clock times, could therefore diverge in timing-derived fields.
2. The in-memory order-rate limiter (`InMemoryOrderRateStore`) was a single mutable
   object shared across a run's validation, walk-forward, and blind windows. Rate-limit
   state from one window could leak into the next, making per-window risk decisions
   depend on execution order/timing rather than on the window's own inputs.
3. Some content-digest computations (`M9DecisionTraceExport`, `M9ProviderFusionExport`)
   hashed the entire export object, including `generatedAt` — an identity/provenance
   field, not replay content — so the digest was not reproducible across two runs with
   different wall-clock generation times.

None of this affects live or paper trading, where `Date.now()` is the correct and
intended time source. It is specific to the research replay path, whose entire purpose
is to be re-run deterministically over sealed historical data (e.g. for crash recovery
via `rederiveValidationMetricsFromSealedDataset`, and for the M9 acceptance gate).

## Decision

**Invariant:** Research replay content must be independent of wall-clock time, random
identity, and process-lifetime mutable state. Two replays over identical fixed inputs
(bars, strategy, cost model, dataset) must produce byte-identical metrics, closed
trades, decision/provider-fusion content digests, and connector-recorded execution
timestamps — regardless of when, how fast, or in what process the replay runs.

To satisfy this invariant:

1. **Deterministic virtual clock** (`lib/trader/research/deterministic-replay-clock.ts`).
   A `DeterministicReplayClock` exposes `nowMs()`/`setNowMs()`. The backtest runner
   (`runBacktest`) advances it to each cycle's evaluated bar time before invoking
   execution/risk/connector deps, via an optional `deps.researchReplayDeterminism.clock`
   hook (`PaperCycleDeps`). Both the M9 v2 campaign script and the in-memory research
   backtest session construct this clock and pass its `nowMs` getter into the risk
   engine, execution service, reconciliation service, and the mock exchange connector.
   Live/paper trading code paths never construct or set this hook and keep using
   `() => Date.now()` unchanged.

2. **Per-window state isolation.** `PaperCycleDeps.researchReplayDeterminism` also
   carries a `resetWindowState()` callback. `runIsolatedResearchBacktest` invokes it
   before running each validation/walk-forward/blind window, clearing the in-memory
   order-rate store (`InMemoryOrderRateStore.clear()`) so rate-limit decisions in one
   window cannot leak into the next. This is additive to the existing Postgres mock
   execution artifact isolation (RI-P7 / DEE-368) and is a no-op when the hook is unset
   (live/paper).

3. **Content digest / identity separation.** Content digests must be computed only over
   the replay's *content* — never over `generatedAt`, `campaignId`, random UUIDs, or
   other wall-clock/identity metadata. `computeDecisionTraceContentDigest` and
   `computeProviderFusionContentDigest` now delegate to the existing
   `computeReplayReproContentDigest` helper (`lib/trader/research/replay-repro-digest.ts`),
   which strips volatile identity fields before hashing. `generatedAt` remains present
   in the exported document as metadata; it is simply excluded from the hash input.

4. **Full-pipeline two-run reproducibility proof** (blocking acceptance gate for PR1).
   `tests/unit/trader-m9-deterministic-replay.test.ts` runs the same fixture bars twice
   through the real research backtest path (real risk engine, real mock-connector
   fills, real SQLite order repository via `createInMemoryResearchBacktestSession`),
   separated by real wall-clock delay and different `generatedAt` inputs, and asserts
   identical metrics, closed-trade counts, decision-trace content digests, and connector
   fill `executedAt` timestamps. A second test proves rate-store window isolation
   directly.

## Consequences

- Research replay is now provably reproducible end-to-end; this is a precondition for
  trusting any Repeat M9 acceptance run.
- `PaperCycleDeps.researchReplayDeterminism` is optional and defaults to `undefined`;
  no behavior change for live/paper trading.
- `createInMemoryResearchBacktestSession` is now `async` (it must call
  `connector.validateCredentials()` before use, matching the campaign script; without
  it every mock order previously failed silently into `RECONCILIATION_REQUIRED`, which
  masked this determinism gap in prior test coverage). Its single caller
  (`rederiveValidationMetricsFromSealedDataset`) is updated accordingly.
- Digest changes are additive at the field level (same schema, different hash input);
  any previously recorded digests for `M9DecisionTraceExport` / `M9ProviderFusionExport`
  computed under the old (non-reproducible) hashing are not comparable to new ones.
  This only affects the M9 v2 research campaign script's own artifacts, not any
  promoted PKA or persisted trading state.
- Out of scope for this PR (deferred, see below): operator authorization/run-profile
  tooling (Task B) and dataset preflight/idempotency (Task C).

## References

- Implementation: `lib/trader/research/deterministic-replay-clock.ts`,
  `lib/trader/backtest/backtest-runner.ts`,
  `lib/trader/research/research-backtest-isolation.ts`,
  `lib/trader/research/m9-decision-trace-export.ts`,
  `lib/trader/research/m9-provider-fusion-export.ts`,
  `lib/trader/research/create-in-memory-research-backtest-session.ts`,
  `scripts/trader/m9-v2-research-campaign.ts`
- Proof: `tests/unit/trader-m9-deterministic-replay.test.ts`
- Related: ADR-0018 (Research Intelligence Layer & Market Knowledge Base), RI-P7 /
  DEE-368 (per-window Postgres mock execution artifact isolation)
