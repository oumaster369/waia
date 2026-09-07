import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";

// Exercise the actual entry point; mock only database/session boundaries.
// This does not replace the PostgreSQL runner/RLS integration proof.
const io = vi.hoisted(() => ({ login: vi.fn(), assume: vi.fn(), reset: vi.fn() }));
vi.mock("@/db/postgres-session-transaction", async importOriginal => ({
  ...await importOriginal<typeof import("@/db/postgres-session-transaction")>(),
  bindPostgresReservedSession: (_pool: unknown, reserved: unknown) => reserved,
}));
vi.mock("@/lib/trader/historical-simulation-v2/historical-runner-role-v2", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/trader/historical-simulation-v2/historical-runner-role-v2")>(),
  requireHistoricalSimulationRunnerLoginV2: io.login,
  assumeHistoricalSimulationRunnerRoleV2: io.assume,
  resetHistoricalSimulationRunnerRoleV2: io.reset,
}));
import { prepareHistoricalTechnicalProposalOnExecutionServerV2,
  finalizeApprovedHistoricalProposalOnExecutionServerV2 } from
  "@/lib/trader/historical-simulation-v2/ratification-split-v2";

const input: Parameters<typeof prepareHistoricalTechnicalProposalOnExecutionServerV2>[1] = {
  preflight: {
    organizationId: "11111111-1111-4111-8111-111111111111", runId: "synthetic-cancel",
    releaseSha: "a".repeat(40), datasetRoot: "/synthetic/data",
    qualificationReceiptPath: "/synthetic/qualification.json",
    runtimeRequalificationReceiptPath: "/synthetic/runtime.json",
    economics: { notionalUsdt: 1000, costRate: 0.001, slippageBufferUsdt: 0.05, nRefUsdt: 1000 },
    htxVolumeQualificationReceiptPaths: { BTCUSDT: "/synthetic/btc.json", ETHUSDT: "/synthetic/eth.json" },
    initialDevelopmentRecordIndex: 0, developmentCycleCount: 200,
  },
  launchPlan: { accountId: "synthetic-account", symbol: "BTCUSDT", primaryHorizonMinutes: 30,
    startingCashUsdt: "100000", defaultQuantity: "0.01", initialRecordIndex: 525600, cycleCount: 35 },
};

beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("WAIA_TRADER_CLI", "1"); });
afterEach(() => vi.unstubAllEnvs());

describe("actual technical proposal cancellation entry point", () => {
  it("refuses an already cancelled operation before reserving or querying a database", async () => {
    const controller = new AbortController(); controller.abort();
    const reserve = vi.fn(); const onProgress = vi.fn();
    await expect(prepareHistoricalTechnicalProposalOnExecutionServerV2(
      { reserve } as unknown as postgres.Sql, input, { signal: controller.signal, onProgress },
    )).rejects.toThrow("TECHNICAL_PREPARATION_CANCELLED");
    expect(reserve).not.toHaveBeenCalled(); expect(onProgress).not.toHaveBeenCalled();
    expect(io.login).not.toHaveBeenCalled();
  });

  it("refuses a non-CLI observer before database reservation", async () => {
    vi.stubEnv("WAIA_TRADER_CLI", "0"); const reserve = vi.fn();
    await expect(prepareHistoricalTechnicalProposalOnExecutionServerV2(
      { reserve } as unknown as postgres.Sql, input, { onProgress: vi.fn() },
    )).rejects.toThrow("TECHNICAL_PREPARATION_OBSERVER_NODE_CLI_REQUIRED");
    expect(reserve).not.toHaveBeenCalled();
  });

  it("releases the acquired run lock, role and connection when cancelled while waiting for the lock", async () => {
    const controller = new AbortController(); const statements: string[] = [];
    const query = vi.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join("?"); statements.push(sql);
      if (sql.includes("pg_advisory_lock(")) controller.abort();
      else if (!sql.includes("pg_advisory_unlock(")) throw new Error("UNEXPECTED_DATABASE_OPERATION");
      return [];
    });
    const release = vi.fn(); Object.assign(query, { release });
    const reserve = vi.fn().mockResolvedValue(query); const onProgress = vi.fn();
    await expect(prepareHistoricalTechnicalProposalOnExecutionServerV2(
      { reserve } as unknown as postgres.Sql, input, { signal: controller.signal, onProgress },
    )).rejects.toThrow("TECHNICAL_PREPARATION_CANCELLED");
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("pg_advisory_lock(");
    expect(statements[1]).toContain("pg_advisory_unlock(");
    expect(io.login).toHaveBeenCalledOnce(); expect(io.assume).toHaveBeenCalledOnce();
    expect(io.reset).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
    expect(onProgress).not.toHaveBeenCalled();
  });
});

describe("actual approved finalization cancellation entry point", () => {
  it("refuses cancellation before reserving a session", async () => {
    const controller = new AbortController(); controller.abort();
    const reserve = vi.fn();
    await expect(finalizeApprovedHistoricalProposalOnExecutionServerV2(
      { reserve } as unknown as postgres.Sql, input.preflight, { signal: controller.signal },
    )).rejects.toThrow("TECHNICAL_PREPARATION_CANCELLED");
    expect(reserve).not.toHaveBeenCalled(); expect(io.assume).not.toHaveBeenCalled();
  });
  it("refuses a non-CLI finalization observer before reserving a session", async () => {
    vi.stubEnv("WAIA_TRADER_CLI", "0"); const reserve = vi.fn();
    await expect(finalizeApprovedHistoricalProposalOnExecutionServerV2(
      { reserve } as unknown as postgres.Sql, input.preflight, { onProgress: vi.fn() },
    )).rejects.toThrow("TECHNICAL_PREPARATION_OBSERVER_NODE_CLI_REQUIRED");
    expect(reserve).not.toHaveBeenCalled();
  });
  it("cleans up the acquired lock and role without reading approvals after cancellation", async () => {
    const controller = new AbortController(); const statements: string[] = [];
    const query = vi.fn(async (parts: TemplateStringsArray) => {
      const statement = parts.join("?"); statements.push(statement);
      if (statement.includes("pg_advisory_lock(")) controller.abort();
      else if (!statement.includes("pg_advisory_unlock(")) throw new Error("UNEXPECTED_DATABASE_OPERATION");
      return [];
    });
    const release = vi.fn(); Object.assign(query, { release });
    await expect(finalizeApprovedHistoricalProposalOnExecutionServerV2(
      { reserve: vi.fn().mockResolvedValue(query) } as unknown as postgres.Sql,
      input.preflight, { signal: controller.signal },
    )).rejects.toThrow("TECHNICAL_PREPARATION_CANCELLED");
    expect(statements).toHaveLength(2); expect(statements[1]).toContain("pg_advisory_unlock(");
    expect(io.assume).toHaveBeenCalledOnce(); expect(io.reset).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
});
