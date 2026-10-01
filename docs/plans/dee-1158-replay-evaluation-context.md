# DEE-1158 — historical evaluation context

## Problem and boundary

Cursor replay emits a warm-up window and then one new closed bar per cycle. The
backtest runner already accumulates the available prefix for other historical
consumers, but passes the single-bar delta to the paper evaluation. A one-bar
feature window has no dispersion and silently reduces subsequent regimes to
CHOP. Actual isolated PostgreSQL research parity diagnostics exposed this; the
coverage and promotion gates correctly refused the resulting evidence.

The correction belongs at the runner-to-evaluation boundary. Cursor IO, canvas
ingestion, execution-on-closed-bar, timestamps, cycle identity and checkpoint
formats keep their existing contracts. An expanding/full source already carries
its evaluation window and is passed through unchanged. For a one-bar delta,
evaluation receives a detached copy of the retained prefix for that exact symbol
and interval, including the current closed bar. The selected history must be
strictly ordered and cannot extend beyond the current evaluation anchor. Other
symbols/intervals cannot become price history for the current instrument.

The existing STREAM_ONLY retention cap remains in force; this change does not
claim arbitrary-history or arbitrary-universe equivalence beyond that existing
contract. FULL retention still grows with the retained history; filtering,
chronology validation and copying cost O(N) per cursor cycle (O(N²) across an
unbounded FULL run). This package does not certify long FULL runtime scale or
invent a new lookback policy. That limit must be included in the release
qualification. Resume uses the already supplied initial prefix. Returned evaluation
snapshots must not observe later prefix appends or mutation of caller-owned bars.
The retained bars travel in a separate evaluation-only input. The source snapshot
still reaches Position Guardian unchanged, so its trailing/exit behavior is not
silently altered by this feature correction. No strategy, cost, threshold,
sample floor or qualification policy changes.

## Evidence and release scope

Keep native RED receipts in the Oct01 audit: authorized synthetic pipeline
produced CHOP-only validation/blind metrics and zero trades. Add real replay and
feature/CDE regressions, including cursor, expanding, resume/PIT, symbol isolation
and captured-history immutability where supported. Run the corrected synthetic
native pipeline with the existing one-shot authorization intact; never reset its
consumption ledger to make a retry pass. DEE1155's independent knowledge-honesty
fix remains required even when coverage improves.

Existing historical outputs are not rewritten or silently requalified. A new
release requires its applicable replay qualification. C3 stays on its frozen
producer/release: no worker, mount, parameter, scoring or holdout action occurs.

Root owns production changes; the delegated author owns only the new regression
file. Independent review, lint/typecheck/build, affected replay/resume tests and
exact-head CI precede merge. Full unit suite runs in CI. Rollback is a revert PR;
no production activation or real order is part of this package.
