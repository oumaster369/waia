import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import type { BarPollSource } from "@/lib/trader/market-data/types";
import { runPaperCycleOnce } from "@/lib/trader/paper/paper-cycle-runner";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type PaperBarCloseLoopConfig = {
  poll: BarPollSource;
  deps: PaperCycleDeps;
  context: OrgContext;
  accountKey: string;
  defaultQuantity: string;
  accountState: AccountRiskState;
  telemetrySink?: WaiaTraderTelemetrySink;
  barIntervalMs?: number;
  maxCycles?: number;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  abortSignal?: AbortSignal;
  newId?: () => string;
};

export type PaperBarCloseLoopResult = {
  cyclesRun: number;
  aborted: boolean;
};

const DEFAULT_BAR_INTERVAL_MS = 60_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function defaultTelemetrySink(line: string): void {
  console.info(line);
}

/**
 * Milliseconds until the next bar-close boundary aligned to `barIntervalMs` from epoch.
 * When `nowMs` is exactly on a boundary, returns 0 (bar just closed — fetch immediately).
 */
export function msUntilNextBarClose(nowMs: number, barIntervalMs: number): number {
  if (barIntervalMs <= 0) {
    throw new Error("[paper-bar-close-loop] barIntervalMs must be positive");
  }

  const remainder = nowMs % barIntervalMs;
  return remainder === 0 ? 0 : barIntervalMs - remainder;
}

/**
 * Timed bar-close orchestrator: sleep to cadence → poll one snapshot → run one mock paper cycle.
 *
 * Off-Cloudflare intent: invoked by `scripts/trader/paper-bar-close-loop.ts` (ADR-0006). Does not
 * deploy a long-running runtime — provides the reusable timed loop primitive only.
 */
export async function runPaperBarCloseLoop(
  config: PaperBarCloseLoopConfig,
): Promise<PaperBarCloseLoopResult> {
  const barIntervalMs = config.barIntervalMs ?? DEFAULT_BAR_INTERVAL_MS;
  const nowMs = config.nowMs ?? Date.now;
  const sleep = config.sleep ?? defaultSleep;
  const telemetrySink = config.telemetrySink ?? defaultTelemetrySink;
  const newId = config.newId ?? (() => crypto.randomUUID());

  if (config.maxCycles !== undefined && config.maxCycles <= 0) {
    throw new Error("[paper-bar-close-loop] maxCycles must be positive when set");
  }

  let cyclesRun = 0;

  while (true) {
    if (config.abortSignal?.aborted) {
      return { cyclesRun, aborted: true };
    }

    const delayMs = msUntilNextBarClose(nowMs(), barIntervalMs);
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    if (config.abortSignal?.aborted) {
      return { cyclesRun, aborted: true };
    }

    const snapshot = await config.poll.fetchSnapshot();

    await runPaperCycleOnce(config.deps, {
      context: config.context,
      snapshot,
      accountKey: config.accountKey,
      defaultQuantity: config.defaultQuantity,
      accountState: config.accountState,
      executionMode: "mock",
      telemetrySink,
      newId,
    });

    cyclesRun += 1;

    if (config.maxCycles !== undefined && cyclesRun >= config.maxCycles) {
      return { cyclesRun, aborted: false };
    }
  }
}
