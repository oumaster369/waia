import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ end: vi.fn(), prepare: vi.fn(), connect: vi.fn() }));
vi.mock("postgres", () => ({ default: mocks.connect }));
vi.mock("@/db/postgres-client", () => ({ waiaCampaignPostgresDriverOptions: () => ({ max: 2 }) }));
vi.mock("@/lib/trader/historical-simulation-v2/ratification-split-v2", () => ({
  prepareHistoricalTechnicalProposalOnExecutionServerV2: mocks.prepare,
  CURRENT_FHV_FIRST_ECONOMIC_RECORD_INDEX_V2: 525600,
}));
import { runHistoricalTechnicalProposalMainV2 } from "../../scripts/trader/historical-simulation-v2-prepare-proposal";

const env = {
  ...process.env, WAIA_TRADER_CLI: "1", DATABASE_URL_POSTGRES_SESSION: "postgresql://runner@example.test/waia",
  WAIA_RELEASE_SHA: "a".repeat(40), WAIA_HISTORICAL_ORGANIZATION_ID: "11111111-1111-4111-8111-111111111111",
  WAIA_HISTORICAL_RUN_ID: "synthetic-proposal", FHV_DATASET_ROOT: "/synthetic/data",
  FHV_PRE_HOLDOUT_QUALIFICATION_RECEIPT_PATH: "/synthetic/qualification.json",
  FHV_RUNTIME_REQUALIFICATION_RECEIPT_PATH: "/synthetic/runtime.json",
  FHV_HTX_VOLUME_BTCUSDT_RECEIPT_PATH: "/synthetic/btc-volume.json",
  FHV_HTX_VOLUME_ETHUSDT_RECEIPT_PATH: "/synthetic/eth-volume.json",
  FHV_INITIAL_DEVELOPMENT_RECORD_INDEX: "0", FHV_DEVELOPMENT_CYCLE_COUNT: "200",
  FHV_ECONOMICS_NOTIONAL_USDT: "1000", FHV_ECONOMICS_COST_RATE: "0.001",
  FHV_ECONOMICS_SLIPPAGE_BUFFER_USDT: "0.05", FHV_ECONOMICS_N_REF_USDT: "1000",
  WAIA_HISTORICAL_ACCOUNT_ID: "synthetic-observer", WAIA_HISTORICAL_SYMBOL: "BTCUSDT",
  WAIA_HISTORICAL_PRIMARY_HORIZON_MINUTES: "30", WAIA_HISTORICAL_STARTING_CASH_USDT: "100000",
  WAIA_HISTORICAL_DEFAULT_QUANTITY: "0.001", WAIA_HISTORICAL_INITIAL_RECORD_INDEX: "525600",
  WAIA_HISTORICAL_CYCLE_COUNT: "35", WAIA_HISTORICAL_OPERATOR_ID: "NEVER_PASS_AS_AUTHORITY",
};
beforeEach(() => {
  vi.resetAllMocks(); mocks.end.mockResolvedValue(undefined);
  mocks.connect.mockReturnValue({ end: mocks.end });
});
afterEach(() => vi.restoreAllMocks());
describe("technical proposal CLI observation boundary", () => {
  it("forwards diagnostic events separately from the completed proposal and disposes the pool", async () => {
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    mocks.prepare.mockImplementation(async (_pool, input, observer) => {
      expect(observer.onProgress).toBeTypeOf("function");
      expect(JSON.stringify(input)).not.toContain("NEVER_PASS_AS_AUTHORITY");
      observer.onProgress({ schemaVersion: "waia.trader.technical_preparation_progress.v2",
        organizationId: input.preflight.organizationId, runId: input.preflight.runId,
        releaseSha: input.preflight.releaseSha, phase: "SCIENTIFIC_PREPARATION", authorityGranted: false });
      expect(out).not.toHaveBeenCalled();
      return { id: "synthetic-proposal-id", proposal: { contentDigestHex: "b".repeat(64) } };
    });
    await runHistoricalTechnicalProposalMainV2(env);
    expect(err).toHaveBeenCalledTimes(1); expect(out).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(err.mock.calls[0]![0]))).toMatchObject({ authorityGranted: false });
    expect(JSON.parse(String(out.mock.calls[0]![0]))).toMatchObject({ proposalId: "synthetic-proposal-id" });
    expect(mocks.end).toHaveBeenCalledWith({ timeout: 5 });
  });
  it("does not print a successful result after preparation failure", async () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const error = new Error("SCIENTIFIC_REFUSAL"); mocks.prepare.mockRejectedValue(error);
    await expect(runHistoricalTechnicalProposalMainV2(env)).rejects.toBe(error);
    expect(out).not.toHaveBeenCalled(); expect(mocks.end).toHaveBeenCalledOnce();
  });
  it("retains progress write failure and still disposes without a final success", async () => {
    const error = new Error("DIAGNOSTIC_WRITE_FAILED");
    vi.spyOn(process.stderr, "write").mockImplementation(() => { throw error; });
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    mocks.prepare.mockImplementation(async (_pool, _input, observer) => observer.onProgress({ phase: "SURFACE_LOAD" }));
    await expect(runHistoricalTechnicalProposalMainV2(env)).rejects.toBe(error);
    expect(out).not.toHaveBeenCalled(); expect(mocks.end).toHaveBeenCalledOnce();
  });
});
