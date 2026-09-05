import { describe, expect, it, vi } from "vitest";

import {
  assumeHistoricalSimulationRunnerRoleV2,
  parseHistoricalSimulationLaunchConsumerCliEnvV2,
  requireHistoricalSimulationRunnerLoginV2,
  resetHistoricalSimulationRunnerRoleV2,
  runHistoricalSimulationLaunchConsumerCliV2,
  type HistoricalSimulationLaunchConsumerDependenciesV2,
} from "@/lib/trader/historical-simulation-v2/launch-consumer-cli-v2";
import { buildHistoricalSimulationRunLifecycleEventV2 } from
  "@/lib/trader/historical-simulation-v2/run-lifecycle-v2";
import { createHistoricalSimulationRunLifecyclePostgresV2 } from
  "@/lib/trader/historical-simulation-v2/run-lifecycle-postgres-v2";

const valid = Object.freeze({
  WAIA_TRADER_CLI: "1",
  DATABASE_URL_POSTGRES_SESSION: "postgresql://runner:secret@db.invalid/waia",
  WAIA_RELEASE_SHA: "A".repeat(40),
  WAIA_HISTORICAL_ORGANIZATION_ID: "11111111-1111-4111-8111-111111111111",
  WAIA_HISTORICAL_RUN_ID: "observed-main-20260904t0900z",
});

function completedEvent() {
  return buildHistoricalSimulationRunLifecycleEventV2({
    organizationId: valid.WAIA_HISTORICAL_ORGANIZATION_ID,
    accountId: "durable-account",
    runId: valid.WAIA_HISTORICAL_RUN_ID,
    partition: "WALK_FORWARD",
    symbol: "BTCUSDT",
    eventSequence: 4,
    phase: "COMPLETED",
    initialRecordIndex: 240,
    terminalRecordIndexExclusive: 243,
    qualifiedTotalCycles: 3,
    committedCycles: 3,
    nextCycleSequence: 3,
    latestCommittedCycleId: "cycle-2",
    requestedByOperatorId: "operator-a",
    observedAt: "2026-09-04T09:00:00.000Z",
    errorCode: null,
    previousContentDigestHex: "1".repeat(64),
  });
}

function runningEvent(committedCycles = 0) {
  return buildHistoricalSimulationRunLifecycleEventV2({
    organizationId: valid.WAIA_HISTORICAL_ORGANIZATION_ID,
    accountId: "durable-account",
    runId: valid.WAIA_HISTORICAL_RUN_ID,
    partition: "WALK_FORWARD",
    symbol: "BTCUSDT",
    eventSequence: 1,
    phase: "RUNNING",
    initialRecordIndex: 240,
    terminalRecordIndexExclusive: 243,
    qualifiedTotalCycles: 3,
    committedCycles,
    nextCycleSequence: committedCycles,
    latestCommittedCycleId: committedCycles === 0 ? null : `cycle-${committedCycles - 1}`,
    requestedByOperatorId: "operator-a",
    observedAt: "2026-09-04T09:00:00.000Z",
    errorCode: null,
    previousContentDigestHex: "1".repeat(64),
  });
}

function lifecycleSql(input: Readonly<{
  acquired?: boolean;
  lifecycle: ReturnType<typeof runningEvent>;
  checkpointCycles: number;
}>) {
  const queries: string[] = [];
  const insertedEvents: unknown[] = [];
  const transaction = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    queries.push(query);
    if (query.includes("pg_try_advisory_lock")) return [{ acquired: input.acquired ?? true }];
    if (query.includes("pg_advisory_xact_lock")) return [];
    if (query.includes("trader_historical_four_surface_ratified_admission_v2")) {
      return [{ release_sha: "a".repeat(40) }];
    }
    if (query.includes("FROM trader_historical_simulation_run_lifecycle_event_v2")) {
      return [{ event_json: input.lifecycle }];
    }
    if (query.includes("FROM trader_historical_simulation_run_start_v2")) {
      return [{ account_id: "durable-account", dataset_authority_digest_hex: "d".repeat(64) }];
    }
    if (query.includes("FROM trader_historical_forecast_input_pit_v2")) {
      return [{ first_record_index: "240" }];
    }
    if (query.includes("FROM trader_historical_dataset_authority_v2")) {
      return [{ qualified_count: "3", minimum_record_index: "240", maximum_record_index: "242" }];
    }
    if (query.includes("FROM trader_historical_simulation_resume_checkpoint_v2")) {
      return input.checkpointCycles === 0 ? [] : [{
        next_cycle_sequence: input.checkpointCycles,
        next_record_index: 240 + input.checkpointCycles,
        committed_cycle_id: `cycle-${input.checkpointCycles - 1}`,
      }];
    }
    if (query.includes("INSERT INTO trader_historical_simulation_run_lifecycle_event_v2")) {
      const serialized = values.find((value) => typeof value === "string" &&
        value.startsWith('{"schemaVersion":"waia.trader.historical_simulation_run_lifecycle.v2"'));
      expect(typeof serialized).toBe("string");
      const event = JSON.parse(serialized as string) as ReturnType<typeof runningEvent>;
      insertedEvents.push(event);
      return [{ content_digest_hex: event.contentDigestHex }];
    }
    throw new Error(`unexpected query: ${query}`);
  });
  Object.assign(transaction, {
    begin: async (
      optionOrCallback: string | ((tx: unknown) => Promise<unknown>),
      maybeCallback?: (tx: unknown) => Promise<unknown>,
    ) => (typeof optionOrCallback === "function" ? optionOrCallback : maybeCallback)!(transaction),
    json: (value: unknown) => value,
  });
  return { sql: transaction as never, queries, insertedEvents };
}

describe("Historical Simulation V2 queued-launch execution consumer", () => {
  it("assumes and verifies the exact least-privilege database role", async () => {
    const unsafe = vi.fn(async () => []);
    const sql = Object.assign(vi.fn(async () => [{ current_user: "waia_historical_runner" }]),
      { unsafe });
    await assumeHistoricalSimulationRunnerRoleV2(sql as never);
    expect(unsafe).toHaveBeenCalledWith("SET ROLE waia_historical_runner");

    const wrong = Object.assign(vi.fn(async () => [{ current_user: "postgres" }]),
      { unsafe: vi.fn(async () => []) });
    await expect(assumeHistoricalSimulationRunnerRoleV2(wrong as never))
      .rejects.toThrow("DATABASE_ROLE");
    expect(wrong.unsafe).toHaveBeenLastCalledWith("RESET ROLE");

    await resetHistoricalSimulationRunnerRoleV2(sql as never);
    expect(unsafe).toHaveBeenLastCalledWith("RESET ROLE");
  });

  it("requires the dedicated LOGIN before SET ROLE on the execution host", async () => {
    const allowed = vi.fn(async () => [{
      session_user: "waia_historical_runner_login",
      current_user: "waia_historical_runner_login",
      rolcanlogin: true,
      rolinherit: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
      rolconnlimit: 2,
      owns_current_database: false,
      has_direct_grants: false,
      owns_objects: false,
      memberships: ["waia_historical_runner"],
    }]);
    await expect(requireHistoricalSimulationRunnerLoginV2(allowed as never))
      .resolves.toBeUndefined();

    for (const identity of [
      { session_user: "postgres", current_user: "postgres" },
      { session_user: "waia_historical_runner_login", current_user: "postgres" },
      {
        session_user: "waia_historical_runner_login",
        current_user: "waia_historical_runner_login",
        rolcanlogin: true,
        rolinherit: false,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
        rolconnlimit: 2,
        owns_current_database: true,
        has_direct_grants: false,
        owns_objects: false,
        memberships: ["waia_historical_runner"],
      },
      {
        session_user: "waia_historical_runner_login",
        current_user: "waia_historical_runner_login",
        rolcanlogin: true,
        rolinherit: false,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
        rolconnlimit: 2,
        owns_current_database: false,
        has_direct_grants: true,
        owns_objects: false,
        memberships: ["waia_historical_runner"],
      },
      {
        session_user: "waia_historical_runner_login",
        current_user: "waia_historical_runner_login",
        rolcanlogin: true,
        rolinherit: false,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
        rolconnlimit: 2,
        owns_current_database: false,
        has_direct_grants: false,
        owns_objects: true,
        memberships: ["waia_historical_runner"],
      },
    ]) {
      const refused = vi.fn(async () => [identity]);
      await expect(requireHistoricalSimulationRunnerLoginV2(refused as never))
        .rejects.toThrow("DATABASE_LOGIN_ROLE");
    }
  });

  it("accepts only exact durable run identity and Postgres/release authority", () => {
    expect(parseHistoricalSimulationLaunchConsumerCliEnvV2({
      ...valid,
      WAIA_HISTORICAL_ACCOUNT_ID: "caller-account",
      WAIA_HISTORICAL_PARTITION: "BLIND_HOLDOUT",
      WAIA_HISTORICAL_SYMBOL: "OTHER",
      WAIA_HISTORICAL_TERMINAL_CYCLE_SEQUENCE: "999999",
      HTX_ACCESS_KEY: "must-not-be-read",
    })).toEqual({
      databaseUrl: valid.DATABASE_URL_POSTGRES_SESSION,
      releaseSha: "a".repeat(40),
      organizationId: valid.WAIA_HISTORICAL_ORGANIZATION_ID,
      runId: valid.WAIA_HISTORICAL_RUN_ID,
    });
  });

  it.each([
    [{ ...valid, WAIA_TRADER_CLI: "0" }, "WAIA_TRADER_CLI"],
    [{ ...valid, DATABASE_URL_POSTGRES_SESSION: undefined,
      DATABASE_URL_POSTGRES: "postgresql://unsafe-fallback/db" }, "DATABASE_URL_POSTGRES_SESSION"],
    [{ ...valid, DATABASE_URL_POSTGRES_SESSION: "file:./local.db" }, "DATABASE_URL_POSTGRES_SESSION"],
    [{ ...valid, WAIA_RELEASE_SHA: "bad" }, "WAIA_RELEASE_SHA"],
    [{ ...valid, WAIA_HISTORICAL_ORGANIZATION_ID: "not-a-uuid" }, "WAIA_HISTORICAL_ORGANIZATION_ID"],
    [{ ...valid, WAIA_HISTORICAL_RUN_ID: "bad run id" }, "WAIA_HISTORICAL_RUN_ID"],
  ])("fails closed for invalid execution authority", (env, code) => {
    expect(() => parseHistoricalSimulationLaunchConsumerCliEnvV2(env)).toThrow(code);
  });

  it("pre-serializes lifecycle event JSON for a reserved-session compatible bind", async () => {
    const { sql, queries, insertedEvents } = lifecycleSql({
      lifecycle: runningEvent(),
      checkpointCycles: 0,
    });
    const lifecycle = createHistoricalSimulationRunLifecyclePostgresV2(sql);
    const recovered = await lifecycle.claim({
      organizationId: valid.WAIA_HISTORICAL_ORGANIZATION_ID,
      runId: valid.WAIA_HISTORICAL_RUN_ID,
      releaseSha: "a".repeat(40),
    });
    expect(insertedEvents).toEqual([recovered]);
    expect(queries.find((query) =>
      query.includes("INSERT INTO trader_historical_simulation_run_lifecycle_event_v2"),
    )).toContain("?::text::jsonb");
  });

  it("claims exactly the requested durable run and closes its database session", async () => {
    const sql = vi.fn() as never;
    const lifecycle = { claim: vi.fn(), queue: vi.fn(), append: vi.fn() } as never;
    const execute = vi.fn(async () => completedEvent());
    const requireRunnerLogin = vi.fn(async () => undefined);
    const assumeRunnerRole = vi.fn(async () => undefined);
    const resetRunnerRole = vi.fn(async () => undefined);
    const dependencies: HistoricalSimulationLaunchConsumerDependenciesV2 = {
      openDatabase: vi.fn(async () => ({ sql, close: vi.fn(async () => undefined) })),
      requireRunnerLogin,
      assumeRunnerRole,
      resetRunnerRole,
      createLifecycle: vi.fn(() => lifecycle),
      execute,
      releaseLease: vi.fn(async () => true),
    };
    const signal = new AbortController().signal;

    const result = await runHistoricalSimulationLaunchConsumerCliV2(valid, dependencies, signal);

    expect(result.phase).toBe("COMPLETED");
    expect(dependencies.openDatabase).toHaveBeenCalledWith(valid.DATABASE_URL_POSTGRES_SESSION);
    expect(requireRunnerLogin).toHaveBeenCalledWith(sql);
    expect(assumeRunnerRole).toHaveBeenCalledWith(sql);
    expect(dependencies.createLifecycle).toHaveBeenCalledWith(sql);
    expect(execute).toHaveBeenCalledWith({
      sql,
      organizationId: valid.WAIA_HISTORICAL_ORGANIZATION_ID,
      runId: valid.WAIA_HISTORICAL_RUN_ID,
      releaseSha: "a".repeat(40),
      lifecycle,
      signal,
    });
    expect(dependencies.releaseLease).toHaveBeenCalledWith(sql, {
      organizationId: valid.WAIA_HISTORICAL_ORGANIZATION_ID,
      runId: valid.WAIA_HISTORICAL_RUN_ID,
    });
    expect(resetRunnerRole).toHaveBeenCalledWith(sql);
    expect(requireRunnerLogin.mock.invocationCallOrder[0]).toBeLessThan(
      assumeRunnerRole.mock.invocationCallOrder[0]!,
    );
    expect(assumeRunnerRole.mock.invocationCallOrder[0]).toBeLessThan(
      execute.mock.invocationCallOrder[0]!,
    );
  });

  it("closes the database session after a refused or failed claim", async () => {
    const sql = vi.fn() as never;
    const failure = new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:NOT_QUEUED");
    const close = vi.fn(async () => undefined);
    const dependencies: HistoricalSimulationLaunchConsumerDependenciesV2 = {
      openDatabase: vi.fn(async () => ({ sql, close })),
      assumeRunnerRole: vi.fn(async () => undefined),
      resetRunnerRole: vi.fn(async () => undefined),
      createLifecycle: vi.fn(() => ({}) as never),
      execute: vi.fn(async () => { throw failure; }),
      releaseLease: vi.fn(async () => false),
    };

    await expect(runHistoricalSimulationLaunchConsumerCliV2(valid, dependencies))
      .rejects.toBe(failure);
    expect(dependencies.releaseLease).toHaveBeenCalledOnce();
    expect(dependencies.resetRunnerRole).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes without touching lifecycle when least-privilege role assumption fails", async () => {
    const sql = vi.fn() as never;
    const close = vi.fn(async () => undefined);
    const execute = vi.fn(async () => completedEvent());
    const dependencies: HistoricalSimulationLaunchConsumerDependenciesV2 = {
      openDatabase: vi.fn(async () => ({ sql, close })),
      assumeRunnerRole: vi.fn(async () => {
        throw new Error("HISTORICAL_SIMULATION_LAUNCH_CONSUMER_REFUSED:DATABASE_ROLE");
      }),
      resetRunnerRole: vi.fn(async () => undefined),
      createLifecycle: vi.fn(() => ({}) as never),
      execute,
      releaseLease: vi.fn(async () => false),
    };

    await expect(runHistoricalSimulationLaunchConsumerCliV2(valid, dependencies))
      .rejects.toThrow("DATABASE_ROLE");
    expect(execute).not.toHaveBeenCalled();
    expect(dependencies.releaseLease).not.toHaveBeenCalled();
    expect(dependencies.resetRunnerRole).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes before SET ROLE or lifecycle access when the dedicated LOGIN is absent", async () => {
    const sql = vi.fn() as never;
    const close = vi.fn(async () => undefined);
    const assumeRunnerRole = vi.fn(async () => undefined);
    const execute = vi.fn(async () => completedEvent());
    const dependencies: HistoricalSimulationLaunchConsumerDependenciesV2 = {
      openDatabase: vi.fn(async () => ({ sql, close })),
      requireRunnerLogin: vi.fn(async () => {
        throw new Error("HISTORICAL_SIMULATION_LAUNCH_CONSUMER_REFUSED:DATABASE_LOGIN_ROLE");
      }),
      assumeRunnerRole,
      resetRunnerRole: vi.fn(async () => undefined),
      createLifecycle: vi.fn(() => ({}) as never),
      execute,
      releaseLease: vi.fn(async () => false),
    };

    await expect(runHistoricalSimulationLaunchConsumerCliV2(valid, dependencies))
      .rejects.toThrow("DATABASE_LOGIN_ROLE");
    expect(assumeRunnerRole).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("checks the deployed SHA against durable ratification before reading or claiming lifecycle", async () => {
    const queries: string[] = [];
    const transaction = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("pg_try_advisory_lock")) return [{ acquired: true }];
      if (query.includes("pg_advisory_xact_lock")) return [];
      if (query.includes("trader_historical_four_surface_ratified_admission_v2")) {
        return [{ release_sha: "b".repeat(40) }];
      }
      throw new Error(`unexpected query: ${query}`);
    });
    const sql = Object.assign(transaction, {
      begin: async (
        optionOrCallback: string | ((tx: unknown) => Promise<unknown>),
        maybeCallback?: (tx: unknown) => Promise<unknown>,
      ) => (typeof optionOrCallback === "function" ? optionOrCallback : maybeCallback)!(transaction),
    });
    const lifecycle = createHistoricalSimulationRunLifecyclePostgresV2(sql as never);

    await expect(lifecycle.claim({
      organizationId: valid.WAIA_HISTORICAL_ORGANIZATION_ID,
      runId: valid.WAIA_HISTORICAL_RUN_ID,
      releaseSha: "a".repeat(40),
    })).rejects.toThrow("RELEASE_AUTHORITY");
    expect(queries.some((query) =>
      query.includes("trader_historical_simulation_run_lifecycle_event_v2"))).toBe(false);
  });

  it("refuses crash recovery while the prior consumer session lease is still active", async () => {
    const { sql, queries } = lifecycleSql({ acquired: false, lifecycle: runningEvent(), checkpointCycles: 0 });
    const lifecycle = createHistoricalSimulationRunLifecyclePostgresV2(sql);
    await expect(lifecycle.claim({ organizationId: valid.WAIA_HISTORICAL_ORGANIZATION_ID,
      runId: valid.WAIA_HISTORICAL_RUN_ID, releaseSha: "a".repeat(40) }))
      .rejects.toThrow("CONSUMER_LEASE_BUSY");
    expect(queries).toHaveLength(1);
  });

  it.each([
    [0, "CRASH_RECOVERED_BEFORE_COMMIT", null],
    [1, "CRASH_RECOVERED_AFTER_COMMIT", "cycle-0"],
  ] as const)("reconciles restart from the durable checkpoint without replaying a commit", async (
    checkpointCycles, errorCode, latestCommittedCycleId,
  ) => {
    const { sql } = lifecycleSql({ lifecycle: runningEvent(), checkpointCycles });
    const lifecycle = createHistoricalSimulationRunLifecyclePostgresV2(sql);
    const recovered = await lifecycle.claim({
      organizationId: valid.WAIA_HISTORICAL_ORGANIZATION_ID,
      runId: valid.WAIA_HISTORICAL_RUN_ID,
      releaseSha: "a".repeat(40),
    });
    expect(recovered).toMatchObject({
      phase: "RUNNING",
      committedCycles: checkpointCycles,
      nextCycleSequence: checkpointCycles,
      latestCommittedCycleId,
      errorCode,
    });
  });

  it("reconciles a final committed checkpoint directly to truthful completion", async () => {
    const { sql } = lifecycleSql({ lifecycle: runningEvent(2), checkpointCycles: 3 });
    const lifecycle = createHistoricalSimulationRunLifecyclePostgresV2(sql);
    const recovered = await lifecycle.claim({
      organizationId: valid.WAIA_HISTORICAL_ORGANIZATION_ID,
      runId: valid.WAIA_HISTORICAL_RUN_ID,
      releaseSha: "a".repeat(40),
    });
    expect(recovered).toMatchObject({
      phase: "COMPLETED",
      committedCycles: 3,
      nextCycleSequence: 3,
      latestCommittedCycleId: "cycle-2",
      errorCode: "CRASH_RECOVERED_AFTER_COMMIT",
    });
  });

  it("fails closed when checkpoint progress is more than one cycle ahead of lifecycle", async () => {
    const { sql } = lifecycleSql({ lifecycle: runningEvent(), checkpointCycles: 2 });
    const lifecycle = createHistoricalSimulationRunLifecyclePostgresV2(sql);
    await expect(lifecycle.claim({
      organizationId: valid.WAIA_HISTORICAL_ORGANIZATION_ID,
      runId: valid.WAIA_HISTORICAL_RUN_ID,
      releaseSha: "a".repeat(40),
    })).rejects.toThrow("RECOVERY_DIVERGENCE");
  });
});
