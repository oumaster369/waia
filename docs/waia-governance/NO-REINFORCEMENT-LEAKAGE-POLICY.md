# WAIA No Reinforcement Leakage Policy

**Date:** 2026-07-05 · **Status:** Binding from M8 (DEE-383) · **Authority:** [`AGENTS.md`](../../AGENTS.md), ADR-0020

Mandatory for every AI-TRADER milestone from M8 onward.

## Purpose

Prevent discovery, evolution, and research automation from using capital outcomes, execution feedback, or descriptive memory scores as hidden fitness signals.

## Rules

1. **No reward hacking** — optimization targets for discovery/comparison must not derive from PnL, returns, or promotion outcomes.
2. **No label leakage** — profitable/unprofitable, win/loss, PnL sign, R-multiple, or execution status must not feed discovery ranking, mutation selection, or hypothesis confidence.
3. **No PnL shortcuts** — backtest PnL may appear in human-facing ADR-0010 promotion packages only.
4. **No hidden execution feedback** — Guardian decisions, skip reasons, risk rejections, and SL/TP triggers are audit facts only.
5. **No future information leakage** — discovery uses pinned dataset digests; blind holdout remains single-use per candidate.
6. **Descriptive memory is not fitness** — M6/M7 confidence tags are co-occurrence/consistency metrics, not success probabilities.
7. **Human-broken actuation** — candidate registration, blind consumption, consolidation, and promotion require operator attestation.

## Enforcement

- Closed evidence-dimension allowlist in `lib/trader/discovery/candidate-comparator.ts`
- `lib/trader/discovery/no-reinforcement-guard.ts` runtime checks
- CI: `tests/unit/trader-discovery-no-reinforcement.test.ts`

## Boundaries

- M6/M7 artifacts: descriptive context for human-reviewed hypothesis generation only ([M7-M8 boundary](../../replay-runs/RI-P7/m7-event-attribution-org0/M7-M8-BOUNDARY.md))
- ADR-0010 evidence class: governance bundle only — not discovery fitness
