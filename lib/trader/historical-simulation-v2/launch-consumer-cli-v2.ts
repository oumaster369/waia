import type postgres from "postgres";

import type { HistoricalSimulationRunLifecycleEventV2 } from "./run-lifecycle-v2";
import type { HistoricalSimulationRunLifecyclePortV2 } from "./launch-orchestrator-v2";
export {
  assumeHistoricalSimulationRunnerRoleV2,
  HISTORICAL_SIMULATION_RUNNER_DATABASE_ROLE_V2,
  HISTORICAL_SIMULATION_RUNNER_LOGIN_ROLE_V2,
  requireHistoricalSimulationRunnerLoginV2,
  resetHistoricalSimulationRunnerRoleV2,
} from "./historical-runner-role-v2";

type CliEnvironment = Readonly<Record<string, string | undefined>>;

export type HistoricalSimulationLaunchConsumerCliConfigV2 = Readonly<{
  databaseUrl: string;
  releaseSha: string;
  organizationId: string;
  runId: string;
}>;

export type HistoricalSimulationLaunchConsumerDependenciesV2 = Readonly<{
  openDatabase(databaseUrl: string): Promise<Readonly<{
    sql: postgres.Sql;
    close(): Promise<void>;
  }>>;
  createLifecycle(sql: postgres.Sql): HistoricalSimulationRunLifecyclePortV2;
  /** Execution-host deployments provide this guard to forbid owner/superuser URIs. */
  requireRunnerLogin?(sql: postgres.Sql): Promise<void>;
  assumeRunnerRole(sql: postgres.Sql): Promise<void>;
  resetRunnerRole(sql: postgres.Sql): Promise<void>;
  execute(input: Readonly<{
    sql: postgres.Sql;
    organizationId: string;
    runId: string;
    releaseSha: string;
    lifecycle: HistoricalSimulationRunLifecyclePortV2;
    signal?: AbortSignal;
  }>): Promise<HistoricalSimulationRunLifecycleEventV2>;
  releaseLease(sql: postgres.Sql, input: Readonly<{
    organizationId: string;
    runId: string;
  }>): Promise<boolean>;
}>;

const SHA = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function required(env: CliEnvironment, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`HISTORICAL_SIMULATION_LAUNCH_CONSUMER_REFUSED:${key}`);
  return value;
}

/**
 * The consumer accepts only the durable launch identity. Account, partition,
 * symbol and cycle bounds are intentionally absent: claim() loads them from the
 * already-qualified lifecycle event and the production runner cannot be widened
 * by execution-host environment variables.
 */
export function parseHistoricalSimulationLaunchConsumerCliEnvV2(
  env: CliEnvironment,
): HistoricalSimulationLaunchConsumerCliConfigV2 {
  if (env.WAIA_TRADER_CLI !== "1") {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_CONSUMER_REFUSED:WAIA_TRADER_CLI");
  }
  const databaseUrl = env.DATABASE_URL_POSTGRES_SESSION?.trim();
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_CONSUMER_REFUSED:DATABASE_URL_POSTGRES_SESSION");
  }
  const releaseSha = required(env, "WAIA_RELEASE_SHA").toLowerCase();
  const organizationId = required(env, "WAIA_HISTORICAL_ORGANIZATION_ID");
  const runId = required(env, "WAIA_HISTORICAL_RUN_ID");
  if (!SHA.test(releaseSha)) {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_CONSUMER_REFUSED:WAIA_RELEASE_SHA");
  }
  if (!UUID.test(organizationId)) {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_CONSUMER_REFUSED:WAIA_HISTORICAL_ORGANIZATION_ID");
  }
  if (!RUN_ID.test(runId)) {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_CONSUMER_REFUSED:WAIA_HISTORICAL_RUN_ID");
  }
  return Object.freeze({ databaseUrl, releaseSha, organizationId, runId });
}

/** Claim and execute exactly one durable queued run, then always close the DB session. */
export async function runHistoricalSimulationLaunchConsumerCliV2(
  env: CliEnvironment,
  dependencies: HistoricalSimulationLaunchConsumerDependenciesV2,
  signal?: AbortSignal,
): Promise<HistoricalSimulationRunLifecycleEventV2> {
  const config = parseHistoricalSimulationLaunchConsumerCliEnvV2(env);
  const opened = await dependencies.openDatabase(config.databaseUrl);
  let runnerRoleAssumed = false;
  try {
    if (dependencies.requireRunnerLogin) {
      await dependencies.requireRunnerLogin(opened.sql);
    }
    await dependencies.assumeRunnerRole(opened.sql);
    runnerRoleAssumed = true;
    return await dependencies.execute({
      sql: opened.sql,
      organizationId: config.organizationId,
      runId: config.runId,
      releaseSha: config.releaseSha,
      lifecycle: dependencies.createLifecycle(opened.sql),
      signal,
    });
  } finally {
    if (runnerRoleAssumed) {
      try {
        await dependencies.releaseLease(opened.sql, {
          organizationId: config.organizationId,
          runId: config.runId,
        });
      } catch {
        // Closing the reserved session is the authoritative lock release fallback.
      }
      try {
        await dependencies.resetRunnerRole(opened.sql);
      } catch {
        // A closed reserved session cannot retain role state or advisory locks.
      }
    }
    await opened.close();
  }
}
