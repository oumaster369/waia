/**
 * Deterministic replay clock (DEE-397 / ADR-0021).
 *
 * Research/backtest replay must never let `Date.now()` reach risk decisions,
 * order-rate accounting, or content digests. This clock is a mutable time
 * source the backtest runner advances to each cycle's evaluated bar time
 * before invoking execution/risk dependencies, so two replays over the same
 * bars produce byte-identical `nowMs()` readings regardless of wall-clock
 * speed. Live/paper trading paths never construct this — they keep using
 * `() => Date.now()` unchanged.
 */
export type DeterministicReplayClock = {
  nowMs(): number;
  setNowMs(ms: number): void;
};

export function createManualReplayClock(initialMs: number): DeterministicReplayClock {
  let currentMs = initialMs;
  return {
    nowMs: () => currentMs,
    setNowMs: (ms: number) => {
      currentMs = ms;
    },
  };
}
