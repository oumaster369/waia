import type postgres from "postgres";

import { runHistoricalSimulationProductionLoopV2 } from "./production-runner-v2";
import type {
  HistoricalSimulationRunLifecycleEventV2,
} from "./run-lifecycle-v2";

export const HISTORICAL_SIMULATION_AUTHENTICATED_LAUNCH_V2 =
  "waia.trader.historical_simulation_authenticated_launch.v2" as const;

export type HistoricalSimulationLaunchIdentityV2 = Readonly<{
  organizationId: string;
  accountId: string;
  runId: string;
  partition: "WALK_FORWARD";
  symbol: "BTCUSDT" | "ETHUSDT";
}>;

export type HistoricalSimulationRunLifecyclePortV2 = Readonly<{
  queue(input: HistoricalSimulationLaunchIdentityV2 & Readonly<{
    requestedByOperatorId: string;
  }>): Promise<HistoricalSimulationRunLifecycleEventV2>;
  claim(input: Readonly<{
    organizationId: string;
    runId: string;
    releaseSha: string;
  }>): Promise<HistoricalSimulationRunLifecycleEventV2>;
  append(input: Readonly<{
    previous: HistoricalSimulationRunLifecycleEventV2;
    phase: "RUNNING" | "COMPLETED" | "FAILED" | "STOPPED";
    committedCycles: number;
    latestCommittedCycleId: string | null;
    errorCode: string | null;
  }>): Promise<HistoricalSimulationRunLifecycleEventV2>;
}>;

function identity(value: string): boolean {
  return typeof value === "string" && value.trim() === value && value.length > 0;
}

function validateLaunchIdentity(input: HistoricalSimulationLaunchIdentityV2): void {
  if (!identity(input.organizationId) || !identity(input.accountId) || !identity(input.runId) ||
      input.partition !== "WALK_FORWARD" ||
      !["BTCUSDT", "ETHUSDT"].includes(input.symbol)) {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:IDENTITY");
  }
}

/**
 * Authentication remains outside this domain seam. The only accepted actor is the
 * operator id returned by the authenticated admin permission boundary; browser
 * callers cannot supply totals, record bounds, release state or capital authority.
 */
export async function queueAuthenticatedHistoricalSimulationLaunchV2(input:
  HistoricalSimulationLaunchIdentityV2 & Readonly<{ authenticatedOperatorId: string }>,
  lifecycle: HistoricalSimulationRunLifecyclePortV2,
): Promise<HistoricalSimulationRunLifecycleEventV2> {
  validateLaunchIdentity(input);
  if (!identity(input.authenticatedOperatorId)) {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:AUTHENTICATED_OPERATOR");
  }
  return lifecycle.queue({
    organizationId: input.organizationId,
    accountId: input.accountId,
    runId: input.runId,
    partition: input.partition,
    symbol: input.symbol,
    requestedByOperatorId: input.authenticatedOperatorId,
  });
}

/** Execution-server entry. Every runner bound is loaded from the durable, qualified launch. */
export async function executeQueuedHistoricalSimulationLaunchV2(input: Readonly<{
  sql: postgres.Sql;
  organizationId: string;
  runId: string;
  releaseSha: string;
  lifecycle: HistoricalSimulationRunLifecyclePortV2;
  signal?: AbortSignal;
  wait?(delayMs: number, signal?: AbortSignal): Promise<void>;
  /** Emitted only after the durable lifecycle claim and release binding succeed. */
  onClaimed?(event: HistoricalSimulationRunLifecycleEventV2): void | Promise<void>;
}>): Promise<HistoricalSimulationRunLifecycleEventV2> {
  if (!identity(input.organizationId) || !identity(input.runId) ||
      !/^[0-9a-f]{40}$/.test(input.releaseSha)) {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:IDENTITY");
  }
  let current = await input.lifecycle.claim({
    organizationId: input.organizationId,
    runId: input.runId,
    releaseSha: input.releaseSha,
  });
  await input.onClaimed?.(current);
  let latestCommittedCycleId = current.latestCommittedCycleId;
  try {
    const result = await runHistoricalSimulationProductionLoopV2({
      sql: input.sql,
      organizationId: current.organizationId,
      accountId: current.accountId,
      runId: current.runId,
      partition: current.partition,
      symbol: current.symbol,
      initialCycleSequence: current.nextCycleSequence,
      terminalCycleSequenceExclusive: current.qualifiedTotalCycles,
    }, {
      signal: input.signal,
      wait: input.wait,
      async onProgress(progress) {
        if (progress.event === "CYCLE_COMMITTED") {
          latestCommittedCycleId = progress.committedCycleId;
          const committedCycles = progress.expectedCycleSequence + 1;
          current = await input.lifecycle.append({
            previous: current,
            phase: committedCycles === current.qualifiedTotalCycles ? "COMPLETED" : "RUNNING",
            committedCycles,
            latestCommittedCycleId,
            errorCode: null,
          });
        } else if (progress.event === "TRANSIENT_RETRY") {
          current = await input.lifecycle.append({
            previous: current,
            phase: "RUNNING",
            committedCycles: current.committedCycles,
            latestCommittedCycleId: current.latestCommittedCycleId,
            errorCode: `TRANSIENT_RETRY_${progress.attempt}`,
          });
        }
      },
    });
    if (result.status === "TERMINAL" && current.phase === "COMPLETED") return current;
    current = await input.lifecycle.append({
      previous: current,
      phase: result.status === "TERMINAL" ? "COMPLETED" : "STOPPED",
      committedCycles: result.nextCycleSequence,
      latestCommittedCycleId,
      errorCode: null,
    });
    return current;
  } catch (error) {
    const code = typeof (error as { code?: unknown } | null)?.code === "string"
      ? String((error as { code: string }).code)
      : error instanceof Error ? error.message.split(":")[0]! : "UNKNOWN";
    await input.lifecycle.append({
      previous: current,
      phase: "FAILED",
      committedCycles: current.committedCycles,
      latestCommittedCycleId: current.latestCommittedCycleId,
      errorCode: code,
    });
    throw error;
  }
}
