import type postgres from "postgres";

import { withRequiredSessionPostgresClient } from "@/db/postgres-client";
import {
  loadHistoricalSimulationBootstrapSourceCyclesV2,
  type HistoricalSimulationBootstrapSourceCycleV2,
} from "@/lib/trader/historical-simulation-v2/bootstrap-source-loader-v2";
import {
  createCanonicalDecisionVerificationReceiptServiceV2,
  historicalDatasetAuthorityRunLockKeyV2,
} from
  "@/lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2";

import {
  buildKmFourSurfaceProductionAuthorityWithHeldPostgresV2,
  type KmFourSurfaceProductionAuthorityV2,
  type KmFourSurfaceProductionBootstrapInputV2,
} from "./km-four-surface-production-bootstrap-v2";
import {
  INTERNAL_persistScientificAdmissionFourSurfaceV2,
  type ScientificAdmissionFourSurfaceReceiptV2,
} from "./scientific-admission-four-surface-repository-postgres-v2";

export const KM_FOUR_SURFACE_PRODUCTION_PREFLIGHT_V2 =
  "km-four-surface-production-preflight/v2" as const;

const SHA = /^[0-9a-f]{40}$/;
const SYMBOLS = ["BTCUSDT", "ETHUSDT"] as const;

export type KmFourSurfaceProductionPreflightInputV2 = Readonly<
  Omit<KmFourSurfaceProductionBootstrapInputV2, "runtimeRequalificationReceiptPath"> & {
    runtimeRequalificationReceiptPath: string;
    htxVolumeQualificationReceiptPaths: Readonly<Record<
      "BTCUSDT" | "ETHUSDT",
      string
    >>;
    initialDevelopmentRecordIndex: number;
    developmentCycleCount: number;
  }
>;

export type KmFourSurfaceScientificAdmissionProductionResultV2 = Readonly<{
  id: string;
  insertedNew: boolean;
  organizationId: string;
  releaseSha: string;
  runId: string;
  developmentDatasetIdentityDigestHex: string;
  sourceQualificationReceiptDigestHex: string;
  sourceFourSurfaceAuthorityContentDigestHex: string;
  evidenceSemanticDigestHex: string;
  contentDigestHex: string;
}>;

export type InternalKmFourSurfaceScientificAdmissionProductionV2 = Readonly<{
  authority: KmFourSurfaceProductionAuthorityV2;
  admission: Readonly<{
    id: string;
    insertedNew: boolean;
    receipt: ScientificAdmissionFourSurfaceReceiptV2;
  }>;
}>;

type LoadedDevelopmentSurface = Readonly<{
  symbol: "BTCUSDT" | "ETHUSDT";
  sources: readonly HistoricalSimulationBootstrapSourceCycleV2[];
}>;

type ProductionPreflightDependencies = Readonly<{
  loadCycles: typeof loadHistoricalSimulationBootstrapSourceCyclesV2;
  assertRunUnused(input: Readonly<{
    runId: string;
    organizationId: string;
  }>): Promise<void>;
  registerAuthorities(input: Readonly<{
    runId: string;
    organizationId: string;
    datasetRoot: string;
    qualificationReceiptPath: string;
    runtimeRequalificationReceiptPath: string;
    htxVolumeQualificationReceiptPaths: Readonly<Record<
      "BTCUSDT" | "ETHUSDT",
      string
    >>;
    releaseSha: string;
    initialDevelopmentRecordIndex: number;
    developmentCycleCount: number;
    surfaces: readonly LoadedDevelopmentSurface[];
  }>): Promise<void>;
  buildAuthority(
    input: KmFourSurfaceProductionBootstrapInputV2,
  ): Promise<KmFourSurfaceProductionAuthorityV2>;
}>;

async function assertRunUnusedWithSql(sql: postgres.Sql, input: Readonly<{
  runId: string;
  organizationId: string;
}>): Promise<void> {
  const [state] = await sql<Array<Readonly<{
    started: boolean;
    preregistered: boolean;
  }>>>`
    SELECT
      EXISTS (
        SELECT 1 FROM trader_historical_simulation_run_start_v2
        WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
      ) AS started,
      EXISTS (
        SELECT 1 FROM trader_dee659_authority_preregistration_v2
        WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
      ) AS preregistered
  `;
  if (!state || state.started || state.preregistered) {
    throw new Error("KM_FOUR_SURFACE_PRODUCTION_PREFLIGHT_REFUSED:RUN_ALREADY_CONSUMED");
  }
}

function reserveSuppliedRunScope(input: KmFourSurfaceProductionPreflightInputV2): Readonly<{
  runId: string;
  releaseSha: string;
}> {
  const releaseSha = input.releaseSha.toLowerCase();
  if (
    !input.runId || input.runId !== input.runId.trim() ||
    !SHA.test(releaseSha) ||
    !Number.isSafeInteger(input.initialDevelopmentRecordIndex) ||
    input.initialDevelopmentRecordIndex < 0 ||
    !Number.isSafeInteger(input.developmentCycleCount) ||
    input.developmentCycleCount < 1 || input.developmentCycleCount > 10_000 ||
    !input.organizationId || !input.datasetRoot || !input.qualificationReceiptPath ||
    !input.runtimeRequalificationReceiptPath ||
    SYMBOLS.some((symbol) => !input.htxVolumeQualificationReceiptPaths[symbol]?.trim())
  ) {
    throw new Error("KM_FOUR_SURFACE_PRODUCTION_PREFLIGHT_REFUSED:INPUT");
  }
  return Object.freeze({ runId: input.runId, releaseSha });
}

async function registerDevelopmentAuthoritiesWithSql(sql: postgres.Sql, input: Readonly<{
  runId: string;
  organizationId: string;
  datasetRoot: string;
  qualificationReceiptPath: string;
  runtimeRequalificationReceiptPath: string;
  htxVolumeQualificationReceiptPaths: Readonly<Record<
    "BTCUSDT" | "ETHUSDT",
    string
  >>;
  releaseSha: string;
  initialDevelopmentRecordIndex: number;
  developmentCycleCount: number;
  surfaces: readonly LoadedDevelopmentSurface[];
}>): Promise<void> {
  const service = createCanonicalDecisionVerificationReceiptServiceV2(sql);
  for (const surface of input.surfaces) {
    const expectedCycleIds = surface.sources.map((source) => source.cycle.cycleId);
    const registered = await service.registerPreHoldoutDatasetAuthorityFromSource({
      datasetRoot: input.datasetRoot,
      organizationId: input.organizationId,
      runId: input.runId,
      partition: "DEVELOPMENT",
      symbol: surface.symbol,
      qualificationReceiptPath: input.qualificationReceiptPath,
      runtimeRequalificationReceiptPath: input.runtimeRequalificationReceiptPath,
      htxVolumeQualificationReceiptPath:
        input.htxVolumeQualificationReceiptPaths[surface.symbol],
      releaseSha: input.releaseSha,
      initialRecordIndex: input.initialDevelopmentRecordIndex,
      cycleCount: input.developmentCycleCount,
    });
    if (
      registered.authorityIds.size !== expectedCycleIds.length ||
      JSON.stringify(registered.cycleIds) !== JSON.stringify(expectedCycleIds) ||
      expectedCycleIds.some((cycleId) => !registered.authorityIds.get(cycleId))
    ) {
      throw new Error("KM_FOUR_SURFACE_PRODUCTION_PREFLIGHT_REFUSED:REGISTRATION");
    }
  }
}

async function withKmFourSurfaceProductionSessionLockV2<T>(
  sql: postgres.Sql,
  scope: Readonly<{ organizationId: string; runId: string }>,
  callback: (connection: postgres.Sql) => Promise<T>,
): Promise<T> {
  const reserved = await sql.reserve();
  const connection = reserved as unknown as postgres.Sql;
  const lockKey = historicalDatasetAuthorityRunLockKeyV2(scope);
  let acquired = false;
  try {
    await connection`SELECT pg_advisory_lock(hashtextextended(${lockKey},0))`;
    acquired = true;
    return await callback(connection);
  } finally {
    try {
      if (acquired) {
        await connection`SELECT pg_advisory_unlock(hashtextextended(${lockKey},0))`;
      }
    } finally {
      reserved.release();
    }
  }
}

function productionDependenciesForHeldConnection(
  sql: postgres.Sql,
): ProductionPreflightDependencies {
  return Object.freeze({
    loadCycles: loadHistoricalSimulationBootstrapSourceCyclesV2,
    assertRunUnused: (scope) => assertRunUnusedWithSql(sql, scope),
    registerAuthorities: (registration) =>
      registerDevelopmentAuthoritiesWithSql(sql, registration),
    buildAuthority: (bootstrap) =>
      buildKmFourSurfaceProductionAuthorityWithHeldPostgresV2(bootstrap, sql),
  });
}

async function prepareInternal(
  input: KmFourSurfaceProductionPreflightInputV2,
  deps: ProductionPreflightDependencies,
): Promise<KmFourSurfaceProductionAuthorityV2> {
  const reserved = reserveSuppliedRunScope(input);
  await deps.assertRunUnused({
    runId: reserved.runId,
    organizationId: input.organizationId,
  });
  const surfaces: LoadedDevelopmentSurface[] = [];
  for (const symbol of SYMBOLS) {
    const sources = await deps.loadCycles({
      datasetRoot: input.datasetRoot,
      qualificationReceiptPath: input.qualificationReceiptPath,
      runtimeRequalificationReceiptPath: input.runtimeRequalificationReceiptPath,
      htxVolumeQualificationReceiptPath: input.htxVolumeQualificationReceiptPaths[symbol],
      releaseSha: reserved.releaseSha,
      organizationId: input.organizationId,
      runId: reserved.runId,
      partition: "DEVELOPMENT",
      symbol,
      initialRecordIndex: input.initialDevelopmentRecordIndex,
      cycleCount: input.developmentCycleCount,
    });
    if (
      sources.length !== input.developmentCycleCount ||
      sources.some((source) =>
        source.cycle.cycleId !==
          `${reserved.runId}:DEVELOPMENT:${symbol}:${source.cycle.barIndex}` ||
        source.membership.cycleId !== source.cycle.cycleId ||
        source.membership.organizationId !== input.organizationId ||
        source.membership.partition !== "DEVELOPMENT" ||
        source.membership.symbol !== symbol)
    ) {
      throw new Error("KM_FOUR_SURFACE_PRODUCTION_PREFLIGHT_REFUSED:SOURCE_SCOPE");
    }
    surfaces.push(Object.freeze({ symbol, sources }));
  }

  await deps.registerAuthorities({
    runId: reserved.runId,
    organizationId: input.organizationId,
    datasetRoot: input.datasetRoot,
    qualificationReceiptPath: input.qualificationReceiptPath,
    runtimeRequalificationReceiptPath: input.runtimeRequalificationReceiptPath,
    htxVolumeQualificationReceiptPaths: input.htxVolumeQualificationReceiptPaths,
    releaseSha: reserved.releaseSha,
    initialDevelopmentRecordIndex: input.initialDevelopmentRecordIndex,
    developmentCycleCount: input.developmentCycleCount,
    surfaces: Object.freeze(surfaces),
  });

  const authority = await deps.buildAuthority({
    runId: reserved.runId,
    datasetRoot: input.datasetRoot,
    qualificationReceiptPath: input.qualificationReceiptPath,
    runtimeRequalificationReceiptPath: input.runtimeRequalificationReceiptPath,
    releaseSha: reserved.releaseSha,
    organizationId: input.organizationId,
    economics: input.economics,
  });
  const expectedCycleIds = surfaces.flatMap((surface) =>
    surface.sources.map((source) => source.cycle.cycleId)).sort();
  const actualCycleIds = Array.isArray(authority.durableDatasetAuthority.cycleIds)
    ? [...authority.durableDatasetAuthority.cycleIds].sort()
    : [];
  if (
    authority.organizationId !== input.organizationId ||
    authority.releaseSha !== reserved.releaseSha ||
    authority.durableDatasetAuthority.organizationId !== input.organizationId ||
    authority.durableDatasetAuthority.runId !== reserved.runId ||
    authority.sourceQualificationReceiptDigestHex !==
      authority.durableDatasetAuthority.qualificationReceiptDigestHex ||
    authority.durableDatasetAuthority.authorityRowCount !== expectedCycleIds.length ||
    JSON.stringify(actualCycleIds) !== JSON.stringify(expectedCycleIds) ||
    authority.contract.surfaces.length !== 4
  ) {
    throw new Error("KM_FOUR_SURFACE_PRODUCTION_PREFLIGHT_REFUSED:AUTHORITY_SCOPE");
  }
  await deps.assertRunUnused({
    runId: reserved.runId,
    organizationId: input.organizationId,
  });
  return authority;
}

/**
 * Trusted DEE-917 -> DEE-918 production composition. The byte-authenticated DEVELOPMENT
 * load, evaluator, durable authority verification and admission INSERT all execute while
 * the same run-scoped session advisory lock and reserved backend are held.
 * Preregistration and run start remain intentionally deferred to DEE-919.
 */
export function createKmFourSurfaceScientificAdmissionProductionV2(
  input: KmFourSurfaceProductionPreflightInputV2,
): Promise<KmFourSurfaceScientificAdmissionProductionResultV2> {
  const reserved = reserveSuppliedRunScope(input);
  return withRequiredSessionPostgresClient((sql) =>
    withKmFourSurfaceProductionSessionLockV2(sql, {
      organizationId: input.organizationId,
      runId: reserved.runId,
    }, async (connection) => {
      const prepared = await INTERNAL_prepareKmFourSurfaceScientificAdmissionWithHeldPostgresV2(
        connection,
        input,
      );
      const persisted = prepared.admission;
      return Object.freeze({
        id: persisted.id,
        insertedNew: persisted.insertedNew,
        organizationId: persisted.receipt.organizationId,
        releaseSha: persisted.receipt.releaseSha,
        runId: persisted.receipt.runId,
        developmentDatasetIdentityDigestHex:
          persisted.receipt.developmentDatasetIdentityDigestHex,
        sourceQualificationReceiptDigestHex:
          persisted.receipt.sourceQualificationReceiptDigestHex,
        sourceFourSurfaceAuthorityContentDigestHex:
          persisted.receipt.sourceFourSurfaceAuthorityContentDigestHex,
        evidenceSemanticDigestHex: persisted.receipt.evidenceSemanticDigestHex,
        contentDigestHex: persisted.receipt.contentDigestHex,
      });
    }));
}

/** Internal DEE-919 composition point. Caller must already hold the run lock. */
export async function INTERNAL_prepareKmFourSurfaceScientificAdmissionWithHeldPostgresV2(
  connection: postgres.Sql,
  input: KmFourSurfaceProductionPreflightInputV2,
): Promise<InternalKmFourSurfaceScientificAdmissionProductionV2> {
  if (typeof (connection as unknown as { release?: unknown }).release !== "function") {
    throw new Error("KM_FOUR_SURFACE_PRODUCTION_PREFLIGHT_REFUSED:DEDICATED_SESSION_REQUIRED");
  }
  const authority = await prepareInternal(
    input,
    productionDependenciesForHeldConnection(connection),
  );
  const admission = await INTERNAL_persistScientificAdmissionFourSurfaceV2(
    connection,
    authority,
  );
  return Object.freeze({ authority, admission });
}

/** TEST_ONLY ordering seam; intentionally not re-exported from the qualification index. */
export function TEST_ONLY_prepareKmFourSurfaceProductionAuthorityV2(
  input: KmFourSurfaceProductionPreflightInputV2,
  dependencies: ProductionPreflightDependencies,
): Promise<KmFourSurfaceProductionAuthorityV2> {
  if (process.env.NODE_ENV !== "test" || process.env.VITEST !== "true") {
    throw new Error("KM_FOUR_SURFACE_PRODUCTION_PREFLIGHT_REFUSED:TEST_ONLY_RUNTIME");
  }
  return prepareInternal(input, dependencies);
}

/** TEST_ONLY lock-lifecycle seam; intentionally not re-exported from the qualification index. */
export function TEST_ONLY_withKmFourSurfaceProductionSessionLockV2<T>(
  sql: postgres.Sql,
  scope: Readonly<{ organizationId: string; runId: string }>,
  callback: (connection: postgres.Sql) => Promise<T>,
): Promise<T> {
  if (process.env.NODE_ENV !== "test" || process.env.VITEST !== "true") {
    throw new Error("KM_FOUR_SURFACE_PRODUCTION_PREFLIGHT_REFUSED:TEST_ONLY_RUNTIME");
  }
  return withKmFourSurfaceProductionSessionLockV2(sql, scope, callback);
}

/** TEST_ONLY real-SQL unused-run assertion; intentionally not re-exported from the index. */
export function TEST_ONLY_assertKmFourSurfaceProductionRunUnusedV2(
  sql: postgres.Sql,
  input: Readonly<{ organizationId: string; runId: string }>,
): Promise<void> {
  if (process.env.NODE_ENV !== "test" || process.env.VITEST !== "true") {
    throw new Error("KM_FOUR_SURFACE_PRODUCTION_PREFLIGHT_REFUSED:TEST_ONLY_RUNTIME");
  }
  return assertRunUnusedWithSql(sql, input);
}
