import postgres from "postgres";
import { fileURLToPath } from "node:url";

import { bindPostgresReservedSession } from
  "../../db/postgres-session-transaction";

import {
  assumeHistoricalSimulationRunnerRoleV2,
  requireHistoricalSimulationRunnerLoginV2,
  resetHistoricalSimulationRunnerRoleV2,
  runHistoricalSimulationLaunchConsumerCliV2,
} from "../../lib/trader/historical-simulation-v2/launch-consumer-cli-v2";
import {
  executeQueuedHistoricalSimulationLaunchV2,
} from "../../lib/trader/historical-simulation-v2/launch-orchestrator-v2";
import {
  createHistoricalSimulationRunLifecyclePostgresV2,
  releaseHistoricalSimulationConsumerLeasePostgresV2,
} from "../../lib/trader/historical-simulation-v2/run-lifecycle-postgres-v2";

export async function runHistoricalSimulationLaunchConsumerMainV2(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    const result = await runHistoricalSimulationLaunchConsumerCliV2(env, {
    async openDatabase(databaseUrl) {
      const pool = postgres(databaseUrl, { max: 1, idle_timeout: 20, connect_timeout: 15 });
      try {
        const reserved = await pool.reserve();
        const bound = bindPostgresReservedSession(pool, reserved);
        return Object.freeze({
          sql: bound,
          async close() {
            reserved.release();
            await pool.end({ timeout: 5 });
          },
        });
      } catch (error) {
        await pool.end({ timeout: 5 });
        throw error;
      }
    },
    requireRunnerLogin: requireHistoricalSimulationRunnerLoginV2,
    assumeRunnerRole: assumeHistoricalSimulationRunnerRoleV2,
    resetRunnerRole: resetHistoricalSimulationRunnerRoleV2,
    createLifecycle: createHistoricalSimulationRunLifecyclePostgresV2,
    execute: (input) => executeQueuedHistoricalSimulationLaunchV2({
      ...input,
      onClaimed(event) {
        process.send?.({
          type: "waia.historical_consumer.claimed.v2",
          runId: event.runId,
          lifecycleDigestHex: event.contentDigestHex,
        });
      },
    }),
    releaseLease: releaseHistoricalSimulationConsumerLeasePostgresV2,
    }, controller.signal);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: "waia.trader.historical_simulation_launch_consumer_result.v2",
      organizationId: result.organizationId,
      accountId: result.accountId,
      runId: result.runId,
      partition: result.partition,
      symbol: result.symbol,
      phase: result.phase,
      committedCycles: result.committedCycles,
      qualifiedTotalCycles: result.qualifiedTotalCycles,
      latestCommittedCycleId: result.latestCommittedCycleId,
      errorCode: result.errorCode,
    })}\n`);
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runHistoricalSimulationLaunchConsumerMainV2().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
