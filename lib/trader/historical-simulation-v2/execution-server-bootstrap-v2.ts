import type postgres from "postgres";

import {
  INTERNAL_prepareHistoricalProductionFirstCycleOnExecutionServerV2,
  type HistoricalProductionFirstCycleBootstrapInputV2,
  type HistoricalProductionFirstCycleBootstrapResultV2,
} from "./production-first-cycle-bootstrap-v2";
import { createHistoricalSimulationRunLifecyclePostgresV2 } from
  "./run-lifecycle-postgres-v2";
import type { HistoricalSimulationRunLifecycleEventV2 } from "./run-lifecycle-v2";
import {
  assumeHistoricalSimulationRunnerRoleV2,
  resetHistoricalSimulationRunnerRoleV2,
} from "./historical-runner-role-v2";

export type HistoricalExecutionServerBootstrapResultV2 = Readonly<{
  bootstrap: HistoricalProductionFirstCycleBootstrapResultV2;
  lifecycle: HistoricalSimulationRunLifecycleEventV2;
}>;

/**
 * Idempotent production bridge from the ratified first-cycle bootstrap to the
 * durable launch queue.  The queue actor is never accepted from a browser,
 * environment variable or manifest; it is the actor embedded in the verified
 * ratification loaded by the bootstrap transaction.
 */
export async function bootstrapAndQueueHistoricalSimulationOnExecutionServerV2(
  sql: postgres.Sql,
  input: HistoricalProductionFirstCycleBootstrapInputV2,
): Promise<HistoricalExecutionServerBootstrapResultV2> {
  const prepared =
    await INTERNAL_prepareHistoricalProductionFirstCycleOnExecutionServerV2(sql, input);
  const bootstrap = prepared.bootstrap;
  const reserved = await sql.reserve();
  let roleAssumed = false;
  try {
    await assumeHistoricalSimulationRunnerRoleV2(reserved);
    roleAssumed = true;
    const lifecycle = await createHistoricalSimulationRunLifecyclePostgresV2(reserved).queue({
      organizationId: bootstrap.organizationId,
      accountId: bootstrap.accountId,
      runId: bootstrap.runId,
      partition: bootstrap.partition,
      symbol: bootstrap.symbol,
      requestedByOperatorId: prepared.ratifiedOperatorUserId,
    });
    return Object.freeze({ bootstrap, lifecycle });
  } finally {
    try {
      if (roleAssumed) await resetHistoricalSimulationRunnerRoleV2(reserved);
    } finally {
      reserved.release();
    }
  }
}
