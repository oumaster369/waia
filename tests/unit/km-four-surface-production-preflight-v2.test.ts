import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type postgres from "postgres";

import { describe, expect, it, vi } from "vitest";

import type { HistoricalSimulationBootstrapSourceCycleV2 } from
  "@/lib/trader/historical-simulation-v2/bootstrap-source-loader-v2";
import type { KmFourSurfaceProductionAuthorityV2 } from
  "@/lib/trader/research/execopp-qualification/km-four-surface-production-bootstrap-v2";
import {
  TEST_ONLY_prepareKmFourSurfaceProductionAuthorityV2,
  TEST_ONLY_withKmFourSurfaceProductionSessionLockV2,
  type KmFourSurfaceProductionPreflightInputV2,
  type KmFourSurfaceScientificAdmissionProductionResultV2,
} from
  "@/lib/trader/research/execopp-qualification/km-four-surface-production-preflight-v2";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000917";
const RUN_ID = "dee-917-production-preflight";
const RELEASE_SHA = "a".repeat(40);
const QUALIFICATION_DIGEST = "b".repeat(64);

function input(): KmFourSurfaceProductionPreflightInputV2 {
  return {
    runId: RUN_ID,
    datasetRoot: "/qualified/dataset",
    qualificationReceiptPath: "/qualified/receipt.json",
    runtimeRequalificationReceiptPath: "/qualified/runtime.json",
    htxVolumeQualificationReceiptPaths: {
      BTCUSDT: "/qualified/btc-volume.json",
      ETHUSDT: "/qualified/eth-volume.json",
    },
    releaseSha: RELEASE_SHA,
    organizationId: ORGANIZATION_ID,
    initialDevelopmentRecordIndex: 100,
    developmentCycleCount: 2,
    economics: {
      notionalUsdt: 1_000,
      costRate: 0.001,
      slippageBufferUsdt: 0.25,
      nRefUsdt: 1_000,
    },
  };
}

function sources(
  symbol: "BTCUSDT" | "ETHUSDT",
  runId: string = RUN_ID,
): readonly HistoricalSimulationBootstrapSourceCycleV2[] {
  return [100, 101].map((barIndex) => {
    const cycleId = `${runId}:DEVELOPMENT:${symbol}:${barIndex}`;
    return {
      cycle: { cycleId, barIndex },
      membership: {
        cycleId,
        organizationId: ORGANIZATION_ID,
        partition: "DEVELOPMENT",
        symbol,
      },
    } as unknown as HistoricalSimulationBootstrapSourceCycleV2;
  });
}

function expectedCycleIds(runId: string = RUN_ID): string[] {
  return (["BTCUSDT", "ETHUSDT"] as const).flatMap((symbol) =>
    sources(symbol, runId).map((source) => source.cycle.cycleId)).sort();
}

function authority(
  runId: string = RUN_ID,
  cycleIds: readonly string[] = expectedCycleIds(runId),
): KmFourSurfaceProductionAuthorityV2 {
  return {
    organizationId: ORGANIZATION_ID,
    releaseSha: RELEASE_SHA,
    sourceQualificationReceiptDigestHex: QUALIFICATION_DIGEST,
    durableDatasetAuthority: {
      organizationId: ORGANIZATION_ID,
      runId,
      qualificationReceiptDigestHex: QUALIFICATION_DIGEST,
      authorityRowCount: cycleIds.length,
      cycleIds,
    },
    contract: { surfaces: [{}, {}, {}, {}] },
  } as unknown as KmFourSurfaceProductionAuthorityV2;
}

function successfulDependencies(events: string[]) {
  return {
    assertRunUnused: vi.fn(async (request: Readonly<{ runId: string }>) => {
      events.push(`unused:${request.runId}`);
    }),
    loadCycles: vi.fn(async (request: Readonly<{
      runId: string;
      symbol: "BTCUSDT" | "ETHUSDT";
    }>) => {
      events.push(`load:${request.runId}:${request.symbol}`);
      return sources(request.symbol, request.runId);
    }),
    registerAuthorities: vi.fn(async (request: Readonly<{
      runId: string;
      surfaces: ReadonlyArray<Readonly<{
        symbol: "BTCUSDT" | "ETHUSDT";
        sources: readonly HistoricalSimulationBootstrapSourceCycleV2[];
      }>>;
    }>) => {
      events.push(`register:${request.runId}`);
      expect(request.surfaces.map((surface) => surface.symbol)).toEqual(["BTCUSDT", "ETHUSDT"]);
      expect(request.surfaces.every((surface) => surface.sources.every((source) =>
        source.cycle.cycleId.startsWith(`${request.runId}:DEVELOPMENT:`)))).toBe(true);
    }),
    buildAuthority: vi.fn(async (request: Readonly<{ runId: string }>) => {
      events.push(`build:${request.runId}`);
      return authority(request.runId);
    }),
  };
}

describe("DEE-917 production preflight orchestrator", () => {
  it("refuses its TEST_ONLY ordering seam outside an actual Vitest runtime", () => {
    try {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("VITEST", "true");
      expect(() => TEST_ONLY_prepareKmFourSurfaceProductionAuthorityV2(
        input(), null as never,
      )).toThrow("TEST_ONLY_RUNTIME");
      expect(() => TEST_ONLY_withKmFourSurfaceProductionSessionLockV2(
        null as never,
        { organizationId: ORGANIZATION_ID, runId: RUN_ID },
        async () => undefined,
      )).toThrow("TEST_ONLY_RUNTIME");

      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("VITEST", "false");
      expect(() => TEST_ONLY_prepareKmFourSurfaceProductionAuthorityV2(
        input(), null as never,
      )).toThrow("TEST_ONLY_RUNTIME");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("uses one supplied runId and registers both DEVELOPMENT surfaces before building", async () => {
    const events: string[] = [];
    const deps = successfulDependencies(events);
    const result = await TEST_ONLY_prepareKmFourSurfaceProductionAuthorityV2(input(), deps);

    expect(result).toBe(await deps.buildAuthority.mock.results[0]!.value);
    expect(events).toEqual([
      `unused:${RUN_ID}`,
      `load:${RUN_ID}:BTCUSDT`,
      `load:${RUN_ID}:ETHUSDT`,
      `register:${RUN_ID}`,
      `build:${RUN_ID}`,
      `unused:${RUN_ID}`,
    ]);
    expect(deps.registerAuthorities).toHaveBeenCalledOnce();
    expect(deps.buildAuthority).toHaveBeenCalledOnce();
  });

  it("propagates a missing durable authority after registration and never reports readiness", async () => {
    const events: string[] = [];
    const deps = successfulDependencies(events);
    deps.buildAuthority.mockImplementationOnce(async (request) => {
      events.push(`build:${request.runId}`);
      throw new Error("KM_FOUR_SURFACE_PRODUCTION_REFUSED:DURABLE_AUTHORITY_SCOPE");
    });

    await expect(TEST_ONLY_prepareKmFourSurfaceProductionAuthorityV2(input(), deps))
      .rejects.toThrow("DURABLE_AUTHORITY_SCOPE");
    expect(events.at(-2)).toBe(`register:${RUN_ID}`);
    expect(events.at(-1)).toBe(`build:${RUN_ID}`);
  });

  it("rejects an authority rebound to another run after exact registration", async () => {
    const events: string[] = [];
    const deps = successfulDependencies(events);
    deps.buildAuthority.mockImplementationOnce(async (request) => {
      events.push(`build:${request.runId}`);
      return authority("changed-run");
    });

    await expect(TEST_ONLY_prepareKmFourSurfaceProductionAuthorityV2(input(), deps))
      .rejects.toThrow("AUTHORITY_SCOPE");
    expect(events.at(-2)).toBe(`register:${RUN_ID}`);
    expect(events.at(-1)).toBe(`build:${RUN_ID}`);
  });

  it("rejects an extra stale durable cycle row instead of accepting a superset", async () => {
    const events: string[] = [];
    const deps = successfulDependencies(events);
    deps.buildAuthority.mockImplementationOnce(async (request) => {
      events.push(`build:${request.runId}`);
      return authority(request.runId, [
        ...expectedCycleIds(request.runId),
        `${request.runId}:DEVELOPMENT:BTCUSDT:99`,
      ]);
    });

    await expect(TEST_ONLY_prepareKmFourSurfaceProductionAuthorityV2(input(), deps))
      .rejects.toThrow("AUTHORITY_SCOPE");
    expect(deps.assertRunUnused).toHaveBeenCalledOnce();
  });

  it("rejects a previously started or preregistered run before registration", async () => {
    const events: string[] = [];
    const deps = successfulDependencies(events);
    deps.assertRunUnused.mockRejectedValueOnce(new Error(
      "KM_FOUR_SURFACE_PRODUCTION_PREFLIGHT_REFUSED:RUN_ALREADY_CONSUMED",
    ));

    await expect(TEST_ONLY_prepareKmFourSurfaceProductionAuthorityV2(input(), deps))
      .rejects.toThrow("RUN_ALREADY_CONSUMED");
    expect(deps.loadCycles).not.toHaveBeenCalled();
    expect(deps.registerAuthorities).not.toHaveBeenCalled();
    expect(deps.buildAuthority).not.toHaveBeenCalled();
  });

  it("rechecks that the run is unused immediately before reporting readiness", async () => {
    const events: string[] = [];
    const deps = successfulDependencies(events);
    deps.assertRunUnused.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error(
      "KM_FOUR_SURFACE_PRODUCTION_PREFLIGHT_REFUSED:RUN_ALREADY_CONSUMED",
    ));

    await expect(TEST_ONLY_prepareKmFourSurfaceProductionAuthorityV2(input(), deps))
      .rejects.toThrow("RUN_ALREADY_CONSUMED");
    expect(deps.registerAuthorities).toHaveBeenCalledOnce();
    expect(deps.buildAuthority).toHaveBeenCalledOnce();
  });

  it("contains no DEE-919 preregistration or run-start call", () => {
    const source = readFileSync(resolve(
      process.cwd(),
      "lib/trader/research/execopp-qualification/km-four-surface-production-preflight-v2.ts",
    ), "utf8");
    expect(source).not.toMatch(/\.preregisterExecution\s*\(/);
    expect(source).not.toMatch(/\.startRun\s*\(/);
    expect(source).toContain("trader_historical_simulation_run_start_v2");
    expect(source).toContain("trader_dee659_authority_preregistration_v2");
  });

  it("builds and persists admission inside the same held-session callback without returning authority", () => {
    const source = readFileSync(resolve(
      process.cwd(),
      "lib/trader/research/execopp-qualification/km-four-surface-production-preflight-v2.ts",
    ), "utf8");
    const productionFlow = source.match(
      /export function createKmFourSurfaceScientificAdmissionProductionV2[\s\S]*?^\}/m,
    )?.[0] ?? "";
    expect(productionFlow).toContain("withKmFourSurfaceProductionSessionLockV2");
    expect(productionFlow).toContain(
      "INTERNAL_prepareKmFourSurfaceScientificAdmissionWithHeldPostgresV2",
    );
    const heldComposition = source.match(
      /export async function INTERNAL_prepareKmFourSurfaceScientificAdmissionWithHeldPostgresV2[\s\S]*?^\}/m,
    )?.[0] ?? "";
    expect(heldComposition.indexOf("prepareInternal")).toBeGreaterThan(-1);
    expect(heldComposition.indexOf("INTERNAL_persistScientificAdmissionFourSurfaceV2"))
      .toBeGreaterThan(heldComposition.indexOf("prepareInternal"));
    const exposesContract: "contract" extends keyof
      KmFourSurfaceScientificAdmissionProductionResultV2 ? true : false = false;
    const exposesAuthority: "sourceAuthority" extends keyof
      KmFourSurfaceScientificAdmissionProductionResultV2 ? true : false = false;
    expect({ exposesContract, exposesAuthority }).toEqual({
      exposesContract: false,
      exposesAuthority: false,
    });
  });

  it("registers through the canonical snapshot API without accepting caller cycles", () => {
    const preflight = readFileSync(resolve(
      process.cwd(),
      "lib/trader/research/execopp-qualification/km-four-surface-production-preflight-v2.ts",
    ), "utf8");
    const canonicalService = readFileSync(resolve(
      process.cwd(),
      "lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2.ts",
    ), "utf8");
    expect(preflight).toContain("service.registerPreHoldoutDatasetAuthorityFromSource");
    expect(preflight).not.toContain("service.registerDatasetAuthority");
    expect(canonicalService).not.toContain(
      "return Object.freeze({ registerDatasetAuthority",
    );
    expect(canonicalService).toContain(
      "return Object.freeze({ registerPreHoldoutDatasetAuthorityFromSource",
    );
    const canonicalInput = canonicalService.match(
      /async function registerPreHoldoutDatasetAuthorityFromSource\(input: Readonly<\{([\s\S]*?)\}>\):/,
    )?.[1] ?? "";
    expect(canonicalInput).not.toMatch(/\bcycles\b|memberships|rawSha256Hex/);
    expect(canonicalService).toContain("loadHistoricalSimulationBootstrapSourceSnapshotV2(input)");
  });

  it("uses one lock key for the preflight session and every authority writer", () => {
    const preflight = readFileSync(resolve(
      process.cwd(),
      "lib/trader/research/execopp-qualification/km-four-surface-production-preflight-v2.ts",
    ), "utf8");
    const bootstrap = readFileSync(resolve(
      process.cwd(),
      "lib/trader/research/execopp-qualification/km-four-surface-production-bootstrap-v2.ts",
    ), "utf8");
    const canonicalService = readFileSync(resolve(
      process.cwd(),
      "lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2.ts",
    ), "utf8");
    expect(preflight).toContain("pg_advisory_lock(hashtextextended(${lockKey},0))");
    expect(preflight).toContain("pg_advisory_unlock(hashtextextended(${lockKey},0))");
    expect(preflight).toContain("productionDependenciesForHeldConnection(connection)");
    expect(preflight).toContain("buildKmFourSurfaceProductionAuthorityWithHeldPostgresV2");
    expect(bootstrap).toContain("loadDurableDatasetAuthorityWithSqlV2({ ...scope, sql })");
    expect(canonicalService).toContain(
      "pg_advisory_xact_lock(hashtextextended(${lockKey},0))",
    );
    expect(preflight).toContain("historicalDatasetAuthorityRunLockKeyV2(scope)");
    expect(canonicalService).toContain("historicalDatasetAuthorityRunLockKeyV2(input)");
  });

  it("always unlocks and releases the dedicated session when work fails", async () => {
    const events: string[] = [];
    const release = vi.fn(() => events.push("release"));
    const connection = Object.assign(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const statement = strings.join("?");
        if (statement.includes("pg_advisory_unlock")) events.push(`unlock:${values[0]}`);
        else if (statement.includes("pg_advisory_lock")) events.push(`lock:${values[0]}`);
        return [];
      },
      { release },
    );
    const sql = {
      reserve: vi.fn(async () => connection),
    } as unknown as postgres.Sql;

    await expect(TEST_ONLY_withKmFourSurfaceProductionSessionLockV2(
      sql,
      { organizationId: ORGANIZATION_ID, runId: RUN_ID },
      async (held) => {
        expect(held).toBe(connection);
        events.push("work");
        throw new Error("expected failure");
      },
    )).rejects.toThrow("expected failure");

    const expectedKey = `historical-dataset-authority-v2:${ORGANIZATION_ID}:${RUN_ID}`;
    expect(events).toEqual([
      `lock:${expectedKey}`,
      "work",
      `unlock:${expectedKey}`,
      "release",
    ]);
    expect(release).toHaveBeenCalledOnce();
  });
});
