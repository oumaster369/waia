import { describe, expect, it, vi } from "vitest";

import {
  HISTORICAL_EXECUTION_SERVER_BOOTSTRAP_MANIFEST_V2,
  parseHistoricalExecutionServerBootstrapManifestV2,
  parseHistoricalExecutionServerLaunchCliEnvV2,
  runHistoricalExecutionServerLaunchCliV2,
} from "@/lib/trader/historical-simulation-v2/execution-server-launch-cli-v2";
import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { buildHistoricalSimulationRunLifecycleEventV2 } from
  "@/lib/trader/historical-simulation-v2/run-lifecycle-v2";
import type { HistoricalProductionFirstCycleBootstrapInputV2 } from
  "@/lib/trader/historical-simulation-v2/production-first-cycle-bootstrap-v2";

const organizationId = "3c50b4e9-1138-43a5-a29f-e65088124cfc";
const releaseSha = "a".repeat(40);
const runId = "observable-wf-run";
const env = Object.freeze({
  WAIA_TRADER_CLI: "1",
  DATABASE_URL_POSTGRES_SESSION: "postgresql://owner@localhost/waia",
  WAIA_RELEASE_SHA: releaseSha,
  WAIA_HISTORICAL_ORGANIZATION_ID: organizationId,
  WAIA_HISTORICAL_RUN_ID: runId,
  WAIA_HISTORICAL_BOOTSTRAP_MANIFEST_PATH: "/opt/waia/control/bootstrap.json",
  WAIA_HISTORICAL_BOOTSTRAP_MANIFEST_CONTENT_DIGEST: "",
});

const bootstrap = Object.freeze({
  preflight: Object.freeze({
    runId,
    datasetRoot: "/opt/waia/datasets/pre-holdout",
    qualificationReceiptPath: "/opt/waia/control/qualification.json",
    runtimeRequalificationReceiptPath: "/opt/waia/control/requalification.json",
    releaseSha,
    organizationId,
    economics: Object.freeze({
      notionalUsdt: 1_000,
      costRate: 0.001,
      slippageBufferUsdt: 0.05,
      nRefUsdt: 1_000,
    }),
    htxVolumeQualificationReceiptPaths: Object.freeze({
      BTCUSDT: "/opt/waia/control/btc-volume.json",
      ETHUSDT: "/opt/waia/control/eth-volume.json",
    }),
    initialDevelopmentRecordIndex: 0,
    developmentCycleCount: 1,
  }),
  ratifiedAuthorityId: "8b61fda0-a2bb-4ec4-9492-ceb18836946e",
  accountId: "modeled-observation-account",
  symbol: "BTCUSDT",
  primaryHorizonMinutes: 30,
  startingCashUsdt: "100000",
  defaultQuantity: "0.01",
  initialRecordIndex: 999,
  cycleCount: 35,
  policyConfig: Object.freeze({ policyInstanceId: "sealed-test-policy" }),
}) as unknown as HistoricalProductionFirstCycleBootstrapInputV2;

function serializedManifest(input = bootstrap) {
  const body = Object.freeze({
    schemaVersion: HISTORICAL_EXECUTION_SERVER_BOOTSTRAP_MANIFEST_V2,
    bootstrap: input,
  });
  const contentDigestHex = computeSemanticSha256Hex(body);
  return Object.freeze({
    serialized: JSON.stringify({ ...body, contentDigestHex }),
    contentDigestHex,
  });
}

function lifecycle(phase: "QUEUED" | "COMPLETED") {
  return buildHistoricalSimulationRunLifecycleEventV2({
    organizationId,
    accountId: bootstrap.accountId,
    runId,
    partition: "WALK_FORWARD",
    symbol: "BTCUSDT",
    eventSequence: phase === "QUEUED" ? 0 : 2,
    phase,
    initialRecordIndex: 240,
    terminalRecordIndexExclusive: 241,
    qualifiedTotalCycles: 1,
    committedCycles: phase === "COMPLETED" ? 1 : 0,
    nextCycleSequence: phase === "COMPLETED" ? 1 : 0,
    latestCommittedCycleId: phase === "COMPLETED" ? `${runId}:cycle:0` : null,
    requestedByOperatorId: "4c06d0d1-1932-4306-b82a-1917900b1427",
    observedAt: "2026-09-04T09:00:00.000Z",
    errorCode: null,
    previousContentDigestHex: phase === "COMPLETED" ? "b".repeat(64) : null,
  });
}

describe("Historical execution-server bootstrap and launch CLI", () => {
  it("accepts one digest-sealed exact-release manifest", () => {
    const manifest = serializedManifest();
    const config = parseHistoricalExecutionServerLaunchCliEnvV2({
      ...env,
      WAIA_HISTORICAL_BOOTSTRAP_MANIFEST_CONTENT_DIGEST: manifest.contentDigestHex,
    });
    expect(parseHistoricalExecutionServerBootstrapManifestV2(
      manifest.serialized,
      config,
    )).toEqual(bootstrap);
  });

  it.each([
    [{ ...bootstrap, symbol: "SOLUSDT" }, "MANIFEST_DIGEST"],
    [{ ...bootstrap, preflight: { ...bootstrap.preflight, runId: "other-run" } },
      "MANIFEST_SCOPE"],
    [{ ...bootstrap, partition: "BLIND_HOLDOUT" }, "MANIFEST_SHAPE"],
    [{ ...bootstrap, privateCredentials: "forbidden" }, "MANIFEST_SHAPE"],
  ])("refuses altered, cross-scope or authority-bearing manifests", (input, errorCode) => {
    const original = serializedManifest();
    const altered = serializedManifest(input as unknown as HistoricalProductionFirstCycleBootstrapInputV2);
    const config = parseHistoricalExecutionServerLaunchCliEnvV2({
      ...env,
      WAIA_HISTORICAL_BOOTSTRAP_MANIFEST_CONTENT_DIGEST:
        errorCode === "MANIFEST_SCOPE" ? altered.contentDigestHex : original.contentDigestHex,
    });
    expect(() => parseHistoricalExecutionServerBootstrapManifestV2(
      altered.serialized,
      config,
    )).toThrow(errorCode);
  });

  it("runs bootstrap, durable queue and consumer in order", async () => {
    const manifest = serializedManifest();
    const queued = lifecycle("QUEUED");
    const completed = lifecycle("COMPLETED");
    const order: string[] = [];
    const bootstrapAndQueue = vi.fn(async () => {
      order.push("bootstrap-and-queue");
      return { bootstrap: {
        schemaVersion: "waia.trader.historical_production_first_cycle_bootstrap.v2" as const,
        organizationId,
        accountId: bootstrap.accountId,
        runId,
        partition: "WALK_FORWARD" as const,
        symbol: "BTCUSDT" as const,
        primaryHorizonMinutes: 30 as const,
        cycleId: `${runId}:cycle:0`,
        pitAnchor: "2026-01-01T04:00:00.000Z",
        forecastId: "forecast-0",
        datasetAuthorityId: "dataset-0",
        ratifiedAuthorityContentDigestHex: "c".repeat(64),
        forecastInputContentDigestHex: "d".repeat(64),
        authorityBoundary: { capitalAuthority: "NONE" as const,
          liveTradingAuthority: "NONE" as const,
          blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED" as const },
      }, lifecycle: queued };
    });
    const consume = vi.fn(async () => {
      order.push("consume");
      return completed;
    });
    const result = await runHistoricalExecutionServerLaunchCliV2({
      ...env,
      WAIA_HISTORICAL_BOOTSTRAP_MANIFEST_CONTENT_DIGEST: manifest.contentDigestHex,
    }, {
      readManifest: vi.fn(async () => manifest.serialized),
      bootstrapAndQueue,
      consume,
    });
    expect(result.lifecycle.phase).toBe("COMPLETED");
    expect(order).toEqual(["bootstrap-and-queue", "consume"]);
    expect(bootstrapAndQueue).toHaveBeenCalledWith(env.DATABASE_URL_POSTGRES_SESSION, bootstrap);
  });

  it("is idempotent when the durable lifecycle is already complete", async () => {
    const manifest = serializedManifest();
    const completed = lifecycle("COMPLETED");
    const consume = vi.fn();
    const result = await runHistoricalExecutionServerLaunchCliV2({
      ...env,
      WAIA_HISTORICAL_BOOTSTRAP_MANIFEST_CONTENT_DIGEST: manifest.contentDigestHex,
    }, {
      readManifest: vi.fn(async () => manifest.serialized),
      bootstrapAndQueue: vi.fn(async () => ({ bootstrap: {} as never, lifecycle: completed })),
      consume,
    });
    expect(result.lifecycle).toBe(completed);
    expect(consume).not.toHaveBeenCalled();
  });
});
