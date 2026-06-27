import {
  safeTraderTelemetryErrorClass,
  type WaiaTraderTelemetrySink,
} from "@/lib/observability/waia-trader-telemetry";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import type { BarPollSource } from "@/lib/trader/market-data/types";
import {
  buildPaperBarCloseCycleCompletePayload,
  createPaperBarCloseRollupCounters,
  emitPaperBarCloseCycleComplete,
  emitPaperBarCloseRollup,
  updatePaperBarCloseRollupCounters,
} from "@/lib/trader/paper/paper-bar-close-loop-telemetry";
import { runPaperCycleOnce } from "@/lib/trader/paper/paper-cycle-runner";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type RefreshAccountStateInput = {
  context: OrgContext;
  orderRepository: OrderRepository;
};

export type PaperBarCloseLoopConfig = {
  poll: BarPollSource;
  deps: PaperCycleDeps;
  context: OrgContext;
  accountKey: string;
  defaultQuantity: string;
  accountState: AccountRiskState;
  orderRepository?: OrderRepository;
  refreshAccountState?: (input: RefreshAccountStateInput) => Promise<AccountRiskState>;
  telemetrySink?: WaiaTraderTelemetrySink;
  /** When set (>= 2), emits an additional `paper_loop` rollup event every N cycles. */
  rollupEveryCycles?: number;
  barIntervalMs?: number;
  maxCycles?: number;
  nowMs?: () => number;
  /** When set, advances by `barIntervalMs` after each completed cycle (deterministic replay). */
  syntheticNowMs?: { current: number };
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
  const nowMs =
    config.syntheticNowMs !== undefined
      ? () => config.syntheticNowMs!.current
      : (config.nowMs ?? Date.now);
  const sleep = config.sleep ?? defaultSleep;
  const telemetrySink = config.telemetrySink ?? defaultTelemetrySink;
  const newId = config.newId ?? (() => crypto.randomUUID());

  if (config.maxCycles !== undefined && config.maxCycles <= 0) {
    throw new Error("[paper-bar-close-loop] maxCycles must be positive when set");
  }

  if (config.rollupEveryCycles !== undefined && config.rollupEveryCycles < 2) {
    throw new Error("[paper-bar-close-loop] rollupEveryCycles must be >= 2 when set");
  }

  if (config.refreshAccountState && !config.orderRepository) {
    throw new Error(
      "[paper-bar-close-loop] orderRepository is required when refreshAccountState is set",
    );
  }

  let accountState = config.accountState;

  let cyclesRun = 0;
  const rollupCounters = createPaperBarCloseRollupCounters();

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

    const cycleStartedMs = nowMs();
    const snapshot = await config.poll.fetchSnapshot();

    const result = await runPaperCycleOnce(config.deps, {
      context: config.context,
      snapshot,
      accountKey: config.accountKey,
      defaultQuantity: config.defaultQuantity,
      accountState,
      executionMode: "mock",
      telemetrySink,
      newId,
      orderRepository: config.orderRepository,
      refreshAccountStateBetweenStrategies: Boolean(
        config.refreshAccountState && config.orderRepository,
      ),
    });

    cyclesRun += 1;

    let stateRefreshed = false;
    try {
      if (config.refreshAccountState && config.orderRepository) {
        accountState = await config.refreshAccountState({
          context: config.context,
          orderRepository: config.orderRepository,
        });
        stateRefreshed = true;
      }
    } catch (err) {
      emitPaperBarCloseCycleComplete(
        {
          organizationId: config.context.organizationId,
          cycleId: snapshot.cycleId,
          cyclesRun,
          durationMs: nowMs() - cycleStartedMs,
          result,
          stateRefreshed: false,
          accountStateAfterCycle: accountState,
          errorClass: safeTraderTelemetryErrorClass(err),
        },
        telemetrySink,
      );
      throw err;
    }

    const cycleCompletePayloadInput = {
      organizationId: config.context.organizationId,
      cycleId: snapshot.cycleId,
      cyclesRun,
      durationMs: nowMs() - cycleStartedMs,
      result,
      stateRefreshed,
      accountStateAfterCycle: accountState,
    };

    emitPaperBarCloseCycleComplete(cycleCompletePayloadInput, telemetrySink);

    if (config.syntheticNowMs !== undefined) {
      config.syntheticNowMs.current += barIntervalMs;
    }

    if (config.rollupEveryCycles !== undefined) {
      const cyclePayload = buildPaperBarCloseCycleCompletePayload(cycleCompletePayloadInput);
      updatePaperBarCloseRollupCounters(rollupCounters, cyclePayload);

      if (cyclesRun % config.rollupEveryCycles === 0) {
        emitPaperBarCloseRollup(
          {
            organizationId: config.context.organizationId,
            cyclesRun,
            rollupEvery: config.rollupEveryCycles,
            countCycleComplete: rollupCounters.countCycleComplete,
            countSignal: rollupCounters.countSignal,
            countNoSignal: rollupCounters.countNoSignal,
            countSubmitted: rollupCounters.countSubmitted,
            countRiskRejected: rollupCounters.countRiskRejected,
            countReconCritical: rollupCounters.countReconCritical,
          },
          telemetrySink,
        );
      }
    }

    if (config.maxCycles !== undefined && cyclesRun >= config.maxCycles) {
      return { cyclesRun, aborted: false };
    }
  }
}
