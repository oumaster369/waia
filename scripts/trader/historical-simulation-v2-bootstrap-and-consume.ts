import { readFile } from "node:fs/promises";

import postgres from "postgres";

import { bootstrapAndQueueHistoricalSimulationOnExecutionServerV2 } from
  "../../lib/trader/historical-simulation-v2/execution-server-bootstrap-v2";
import { runHistoricalExecutionServerLaunchCliV2 } from
  "../../lib/trader/historical-simulation-v2/execution-server-launch-cli-v2";
import {
  assumeHistoricalSimulationRunnerRoleV2,
  resetHistoricalSimulationRunnerRoleV2,
  runHistoricalSimulationLaunchConsumerCliV2,
} from "../../lib/trader/historical-simulation-v2/launch-consumer-cli-v2";
import { executeQueuedHistoricalSimulationLaunchV2 } from
  "../../lib/trader/historical-simulation-v2/launch-orchestrator-v2";
import {
  createHistoricalSimulationRunLifecyclePostgresV2,
  releaseHistoricalSimulationConsumerLeasePostgresV2,
} from "../../lib/trader/historical-simulation-v2/run-lifecycle-postgres-v2";

const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGTERM", stop);
process.once("SIGINT", stop);

async function consume(signal?: AbortSignal) {
  return runHistoricalSimulationLaunchConsumerCliV2(process.env, {
    async openDatabase(databaseUrl) {
      const pool = postgres(databaseUrl, {
        max: 1,
        idle_timeout: 20,
        connect_timeout: 15,
      });
      try {
        const reserved = await pool.reserve();
        return Object.freeze({
          sql: reserved,
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
    assumeRunnerRole: assumeHistoricalSimulationRunnerRoleV2,
    resetRunnerRole: resetHistoricalSimulationRunnerRoleV2,
    createLifecycle: createHistoricalSimulationRunLifecyclePostgresV2,
    execute: executeQueuedHistoricalSimulationLaunchV2,
    releaseLease: releaseHistoricalSimulationConsumerLeasePostgresV2,
  }, signal);
}

try {
  const result = await runHistoricalExecutionServerLaunchCliV2(process.env, {
    readManifest: (path) => readFile(path, "utf8"),
    async bootstrapAndQueue(databaseUrl, input) {
      const pool = postgres(databaseUrl, {
        max: 1,
        idle_timeout: 20,
        connect_timeout: 15,
      });
      try {
        return await bootstrapAndQueueHistoricalSimulationOnExecutionServerV2(pool, input);
      } finally {
        await pool.end({ timeout: 5 });
      }
    },
    consume: (_env, signal) => consume(signal),
  }, controller.signal);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "waia.trader.historical_execution_server_launch_result.v2",
    organizationId: result.lifecycle.organizationId,
    accountId: result.lifecycle.accountId,
    runId: result.lifecycle.runId,
    partition: result.lifecycle.partition,
    symbol: result.lifecycle.symbol,
    phase: result.lifecycle.phase,
    committedCycles: result.lifecycle.committedCycles,
    qualifiedTotalCycles: result.lifecycle.qualifiedTotalCycles,
    latestCommittedCycleId: result.lifecycle.latestCommittedCycleId,
    errorCode: result.lifecycle.errorCode,
  })}\n`);
} finally {
  process.removeListener("SIGTERM", stop);
  process.removeListener("SIGINT", stop);
}
