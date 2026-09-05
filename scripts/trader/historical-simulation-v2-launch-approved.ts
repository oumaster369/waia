import postgres from "postgres";
import { fileURLToPath } from "node:url";

import { waiaCampaignPostgresDriverOptions } from "../../db/postgres-client";
import { bindPostgresReservedSession } from
  "../../db/postgres-session-transaction";
import { bootstrapAndQueueHistoricalSimulationOnExecutionServerV2 } from
  "../../lib/trader/historical-simulation-v2/execution-server-bootstrap-v2";
import {
  assumeHistoricalSimulationRunnerRoleV2,
  requireHistoricalSimulationRunnerLoginV2,
  resetHistoricalSimulationRunnerRoleV2,
  runHistoricalSimulationLaunchConsumerCliV2,
} from "../../lib/trader/historical-simulation-v2/launch-consumer-cli-v2";
import { executeQueuedHistoricalSimulationLaunchV2 } from
  "../../lib/trader/historical-simulation-v2/launch-orchestrator-v2";
import { finalizeApprovedHistoricalProposalOnExecutionServerV2 } from
  "../../lib/trader/historical-simulation-v2/ratification-split-v2";
import { runApprovedHistoricalLaunchCliV2 } from
  "../../lib/trader/historical-simulation-v2/ratification-execution-cli-v2";
import {
  createHistoricalSimulationRunLifecyclePostgresV2,
  releaseHistoricalSimulationConsumerLeasePostgresV2,
} from "../../lib/trader/historical-simulation-v2/run-lifecycle-postgres-v2";

function sendControllerMessage(message: Readonly<Record<string, unknown>>): void {
  process.send?.(message);
}

/** Ensures every backend reserved by finalize/bootstrap authenticates as the constrained LOGIN. */
export function bindHistoricalRunnerLoginGuardedPoolV2(
  pool: postgres.Sql,
  requireLogin: (sql: postgres.Sql) => Promise<void> = requireHistoricalSimulationRunnerLoginV2,
): postgres.Sql {
  return new Proxy(pool, {
    apply(target, _thisArg, argumentsList) {
      return Reflect.apply(target, target, argumentsList);
    },
    get(target, property) {
      if (property === "reserve") {
        return async () => {
          const reserved = await target.reserve();
          try {
            await requireLogin(reserved as unknown as postgres.Sql);
            return reserved;
          } catch (error) {
            reserved.release();
            throw error;
          }
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as postgres.Sql;
}

/**
 * Canonical execution-host pipeline. A Human-approved durable proposal is
 * finalized and bootstrapped before exactly one consumer may claim the run.
 */
export async function runHistoricalSimulationApprovedLaunchMainV2(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  async function consume(signal?: AbortSignal) {
    return runHistoricalSimulationLaunchConsumerCliV2(env, {
      async openDatabase(databaseUrl) {
        const pool = postgres(databaseUrl, waiaCampaignPostgresDriverOptions());
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
          sendControllerMessage({
            type: "waia.historical_consumer.claimed.v2",
            runId: event.runId,
            lifecycleDigestHex: event.contentDigestHex,
          });
        },
      }),
      releaseLease: releaseHistoricalSimulationConsumerLeasePostgresV2,
    }, signal);
  }

  try {
    const result = await runApprovedHistoricalLaunchCliV2(env, {
      async finalize(databaseUrl, scope) {
        const pool = postgres(databaseUrl, waiaCampaignPostgresDriverOptions());
        try {
          return await finalizeApprovedHistoricalProposalOnExecutionServerV2(
            bindHistoricalRunnerLoginGuardedPoolV2(pool),
            scope,
          );
        } finally {
          await pool.end({ timeout: 5 });
        }
      },
      async bootstrap(databaseUrl, manifest) {
        const pool = postgres(databaseUrl, waiaCampaignPostgresDriverOptions());
        try {
          return await bootstrapAndQueueHistoricalSimulationOnExecutionServerV2(
            bindHistoricalRunnerLoginGuardedPoolV2(pool),
            manifest.bootstrap,
          );
        } finally {
          await pool.end({ timeout: 5 });
        }
      },
      consume: (_env, signal) => consume(signal),
    }, controller.signal);

    if (result.lifecycle.phase === "COMPLETED") {
      sendControllerMessage({
        type: "waia.historical_consumer.completed.v2",
        runId: result.lifecycle.runId,
        lifecycleDigestHex: result.lifecycle.contentDigestHex,
      });
    }
    process.stdout.write(`${JSON.stringify({
      schemaVersion: "waia.trader.historical_approved_launch_cli_result.v2",
      authorityId: result.authorityId,
      organizationId: result.lifecycle.organizationId,
      accountId: result.lifecycle.accountId,
      runId: result.lifecycle.runId,
      phase: result.lifecycle.phase,
      committedCycles: result.lifecycle.committedCycles,
      qualifiedTotalCycles: result.lifecycle.qualifiedTotalCycles,
      errorCode: result.lifecycle.errorCode,
    })}\n`);
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runHistoricalSimulationApprovedLaunchMainV2().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
