/**
 * Research backtest cycle ID prefixes — secondary defense against cross-phase idempotency collision.
 */

export function buildResearchValidationCycleIdPrefix(backtestRunId: string): string {
  return `ri-val-${backtestRunId}`;
}

export function buildResearchWalkForwardCycleIdPrefix(
  backtestRunId: string,
  windowIndex: number,
): string {
  return `ri-wf-${backtestRunId}-${windowIndex}`;
}

export function buildResearchBlindCycleIdPrefix(backtestRunId: string): string {
  return `ri-blind-${backtestRunId}`;
}
