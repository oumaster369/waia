import { describe, expect, it, vi } from "vitest";

import {
  parseHistoricalTechnicalProposalCliEnvV2,
  runApprovedHistoricalLaunchCliV2,
} from "@/lib/trader/historical-simulation-v2/ratification-execution-cli-v2";

const base = {
  WAIA_TRADER_CLI: "1",
  DATABASE_URL_POSTGRES_SESSION: "postgresql://runner@example.test/waia",
  WAIA_RELEASE_SHA: "a".repeat(40),
  WAIA_HISTORICAL_ORGANIZATION_ID: "11111111-1111-4111-8111-111111111111",
  WAIA_HISTORICAL_RUN_ID: "run-1",
};
const proposal = {
  ...base,
  FHV_DATASET_ROOT: "/data/fhv",
  FHV_PRE_HOLDOUT_QUALIFICATION_RECEIPT_PATH: "/data/fhv/qualification.json",
  FHV_RUNTIME_REQUALIFICATION_RECEIPT_PATH: "/data/fhv/runtime.json",
  FHV_HTX_VOLUME_BTCUSDT_RECEIPT_PATH: "/data/fhv/btc-volume.json",
  FHV_HTX_VOLUME_ETHUSDT_RECEIPT_PATH: "/data/fhv/eth-volume.json",
  FHV_INITIAL_DEVELOPMENT_RECORD_INDEX: "0",
  FHV_DEVELOPMENT_CYCLE_COUNT: "200",
  FHV_ECONOMICS_NOTIONAL_USDT: "1000",
  FHV_ECONOMICS_COST_RATE: "0.001",
  FHV_ECONOMICS_SLIPPAGE_BUFFER_USDT: "0.05",
  FHV_ECONOMICS_N_REF_USDT: "1000",
  WAIA_HISTORICAL_ACCOUNT_ID: "historical-observer",
  WAIA_HISTORICAL_SYMBOL: "BTCUSDT",
  WAIA_HISTORICAL_PRIMARY_HORIZON_MINUTES: "30",
  WAIA_HISTORICAL_STARTING_CASH_USDT: "10000",
  WAIA_HISTORICAL_DEFAULT_QUANTITY: "0.001",
  WAIA_HISTORICAL_INITIAL_RECORD_INDEX: "525600",
  WAIA_HISTORICAL_CYCLE_COUNT: "35",
  WAIA_HISTORICAL_OPERATOR_ID: "must-never-be-consumed",
};

describe("Historical split execution CLI", () => {
  it("builds exact technical input without any CLI actor authority", () => {
    const parsed = parseHistoricalTechnicalProposalCliEnvV2(proposal);
    expect(parsed.preflight).toMatchObject({ runId: "run-1", developmentCycleCount: 200,
      economics: { notionalUsdt: 1000, costRate: 0.001 } });
    expect(parsed.launchPlan).toMatchObject({ initialRecordIndex: 525600, cycleCount: 35 });
    expect(JSON.stringify(parsed)).not.toContain("must-never-be-consumed");
  });

  it("fails closed on unsafe paths and unsupported launch surfaces", () => {
    expect(() => parseHistoricalTechnicalProposalCliEnvV2({ ...proposal,
      FHV_DATASET_ROOT: "relative/path" })).toThrow(/FHV_DATASET_ROOT/);
    expect(() => parseHistoricalTechnicalProposalCliEnvV2({ ...proposal,
      WAIA_HISTORICAL_PRIMARY_HORIZON_MINUTES: "15" })).toThrow(/PRIMARY_HORIZON/);
    expect(() => parseHistoricalTechnicalProposalCliEnvV2({ ...proposal,
      WAIA_HISTORICAL_INITIAL_RECORD_INDEX: "525599" })).toThrow(/INITIAL_RECORD_INDEX/);
  });

  it("loads the approved authority, builds the in-memory manifest, queues, then consumes", async () => {
    const calls: string[] = [];
    const manifest = { schemaVersion: "waia.trader.historical_execution_server_bootstrap_manifest.v2",
      bootstrap: { preflight: { organizationId: base.WAIA_HISTORICAL_ORGANIZATION_ID,
        runId: "run-1", releaseSha: base.WAIA_RELEASE_SHA } }, contentDigestHex: "b".repeat(64) };
    const queued = { phase: "QUEUED" };
    const completed = { phase: "COMPLETED" };
    const result = await runApprovedHistoricalLaunchCliV2(base, {
      finalize: vi.fn(async () => { calls.push("finalize"); return {
        authorityId: "authority-1", manifest: manifest as never } }),
      bootstrap: vi.fn(async () => { calls.push("bootstrap"); return {
        bootstrap: {}, lifecycle: queued } as never }),
      consume: vi.fn(async () => { calls.push("consume"); return completed as never }),
    });
    expect(calls).toEqual(["finalize", "bootstrap", "consume"]);
    expect(result.lifecycle).toBe(completed);
  });

  it("never bootstraps or consumes when no approved proposal can be finalized", async () => {
    const refusal = new Error("HISTORICAL_RATIFICATION_EXECUTION_REFUSED:APPROVAL_NOT_FOUND");
    const bootstrap = vi.fn();
    const consume = vi.fn();
    await expect(runApprovedHistoricalLaunchCliV2(base, {
      finalize: vi.fn(async () => { throw refusal; }),
      bootstrap,
      consume,
    })).rejects.toBe(refusal);
    expect(bootstrap).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it("fails before queue and consume when the deployed SHA is not approved", async () => {
    const refusal = new Error("HISTORICAL_RATIFICATION_EXECUTION_REFUSED:RELEASE_SHA_MISMATCH");
    const bootstrap = vi.fn();
    const consume = vi.fn();
    await expect(runApprovedHistoricalLaunchCliV2({ ...base,
      WAIA_RELEASE_SHA: "b".repeat(40),
    }, {
      finalize: vi.fn(async () => { throw refusal; }),
      bootstrap,
      consume,
    })).rejects.toBe(refusal);
    expect(bootstrap).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it("is idempotently healthy on restart after a terminal COMPLETED lifecycle", async () => {
    const manifest = {
      schemaVersion: "waia.trader.historical_execution_server_bootstrap_manifest.v2",
      bootstrap: { preflight: { organizationId: base.WAIA_HISTORICAL_ORGANIZATION_ID,
        runId: "run-1", releaseSha: base.WAIA_RELEASE_SHA } },
      contentDigestHex: "b".repeat(64),
    };
    const completed = { phase: "COMPLETED" };
    const consume = vi.fn();
    const result = await runApprovedHistoricalLaunchCliV2(base, {
      finalize: vi.fn(async () => ({ authorityId: "authority-1", manifest: manifest as never })),
      bootstrap: vi.fn(async () => ({ bootstrap: {}, lifecycle: completed }) as never),
      consume,
    });
    expect(result.lifecycle).toBe(completed);
    expect(consume).not.toHaveBeenCalled();
  });
});
