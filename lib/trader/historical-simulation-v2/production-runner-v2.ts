import type postgres from "postgres";
import { runHistoricalSimulationNextCyclePostgresV2 } from "./atomic-cycle-repository-postgres-v2";

export type HistoricalSimulationProductionRunnerConfigV2 = Readonly<{
  sql: postgres.Sql; organizationId: string; accountId: string; runId: string;
  partition: "DEVELOPMENT" | "WALK_FORWARD"; symbol: "BTCUSDT" | "ETHUSDT";
  initialCycleSequence?: number; terminalCycleSequenceExclusive: number; maxTransientRetries?: number;
}>;
export type HistoricalSimulationProductionRunnerProgressV2 = Readonly<{
  event: "START" | "CYCLE_COMMITTED" | "TRANSIENT_RETRY" | "TERMINAL" | "STOPPED";
  expectedCycleSequence: number; attempt: number; committedCycleId: string | null;
}>;
export type HistoricalSimulationProductionRunnerResultV2 = Readonly<{
  status: "TERMINAL" | "STOPPED"; committedCycles: number; nextCycleSequence: number;
}>;

const TRANSIENT_CODES = new Set(["40001", "40P01", "57P01", "57P02", "57P03", "08000", "08001",
  "08003", "08004", "08006", "08007", "08P01"]);
class HistoricalSimulationRunnerCursorSequenceV2Error extends Error {
  readonly code = "HISTORICAL_SIMULATION_RUNNER_CURSOR_SEQUENCE_V2";
  constructor() {
    super("HISTORICAL_SIMULATION_V2_RUNNER_REFUSED:CURSOR_SEQUENCE");
    this.name = "HistoricalSimulationRunnerCursorSequenceV2Error";
  }
}

function transient(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return typeof code === "string" && TRANSIENT_CODES.has(code);
}

/** Sequential identity-only driver. A cycle is never skipped and a retry retains the same sequence. */
export async function runHistoricalSimulationProductionLoopV2(input: HistoricalSimulationProductionRunnerConfigV2,
  control: Readonly<{ signal?: AbortSignal;
    onProgress?(progress: HistoricalSimulationProductionRunnerProgressV2): unknown;
    wait?(delayMs: number, signal?: AbortSignal): Promise<void>; retryDelayMs?: number }> = {},
): Promise<HistoricalSimulationProductionRunnerResultV2> {
  let sequence = input.initialCycleSequence ?? 0; let committed = 0;
  const maxRetries = input.maxTransientRetries ?? 3;
  if (!input.organizationId.trim() || !input.accountId.trim() || !input.runId.trim() ||
      !["DEVELOPMENT", "WALK_FORWARD"].includes(input.partition) ||
      !["BTCUSDT", "ETHUSDT"].includes(input.symbol) ||
      !Number.isSafeInteger(sequence) || sequence < 0 ||
      !Number.isSafeInteger(input.terminalCycleSequenceExclusive) || input.terminalCycleSequenceExclusive < sequence ||
      !Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new Error("HISTORICAL_SIMULATION_V2_RUNNER_REFUSED:CONFIG");
  }
  const emit = async (progress: HistoricalSimulationProductionRunnerProgressV2): Promise<void> => {
    await control.onProgress?.(Object.freeze(progress));
  };
  const wait = control.wait ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const retryDelayMs = control.retryDelayMs ?? 250;
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) throw new Error("HISTORICAL_SIMULATION_V2_RUNNER_REFUSED:CONFIG");
  await emit({ event: "START", expectedCycleSequence: sequence, attempt: 0, committedCycleId: null });
  while (!control.signal?.aborted) {
    if (sequence === input.terminalCycleSequenceExclusive) {
      await emit({ event: "TERMINAL", expectedCycleSequence: sequence, attempt: 0, committedCycleId: null });
      return Object.freeze({ status: "TERMINAL", committedCycles: committed, nextCycleSequence: sequence });
    }
    let attempt = 0;
    for (;;) {
      try {
        const cursor = await runHistoricalSimulationNextCyclePostgresV2({ sql: input.sql,
          organizationId: input.organizationId, accountId: input.accountId, runId: input.runId,
          partition: input.partition, symbol: input.symbol, expectedCycleSequence: sequence });
        if (!cursor.committedCycleId?.trim() || cursor.nextCycleSequence !== sequence + 1 ||
            cursor.nextCycleSequence > input.terminalCycleSequenceExclusive) {
          throw new HistoricalSimulationRunnerCursorSequenceV2Error();
        }
        await emit({ event: "CYCLE_COMMITTED", expectedCycleSequence: sequence, attempt,
          committedCycleId: cursor.committedCycleId });
        sequence = cursor.nextCycleSequence; committed += 1; break;
      } catch (error) {
        if (!transient(error) || attempt >= maxRetries) throw error;
        attempt += 1;
        await emit({ event: "TRANSIENT_RETRY", expectedCycleSequence: sequence, attempt, committedCycleId: null });
        await wait(retryDelayMs * attempt, control.signal);
        if (control.signal?.aborted) break;
      }
    }
  }
  await emit({ event: "STOPPED", expectedCycleSequence: sequence, attempt: 0, committedCycleId: null });
  return Object.freeze({ status: "STOPPED", committedCycles: committed, nextCycleSequence: sequence });
}
