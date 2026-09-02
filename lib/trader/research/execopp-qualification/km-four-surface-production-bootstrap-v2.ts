import type postgres from "postgres";

import { withWaiaPostgresClient } from "@/db/postgres-client";
import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import {
  computeDecisionEvRangeV1,
  computeReplicaPayoffMeans,
} from "@/lib/trader/intelligence/decision-economics/decision-economics-v2";
import {
  buildPredictivePackageV1,
  issueForecastV1,
  type SourceAnchor,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { buildHistoricalForecastFamilyV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
import {
  loadHistoricalDevelopmentSourceCorpusSnapshotFromDatasetV2,
  type HistoricalDevelopmentSourceCorpusSnapshotV2,
} from
  "@/lib/trader/historical-simulation-v2/development-source-corpus-v2";
import {
  assertFhvPreHoldoutFilesMatchReceipt,
  assertFhvPreHoldoutQualificationPass,
  readFhvPreHoldoutQualificationReceipt,
  type FhvPreHoldoutQualificationReceiptV1,
} from "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import {
  readFhvPreHoldoutRuntimeRequalification,
  type FhvPreHoldoutRuntimeRequalificationV1,
} from "@/lib/trader/market-data/fhv-pre-holdout-runtime-requalification";
import { energyMcFromNestedCubeV1 } from
  "@/lib/trader/research/benchmark/energy-mc-v1";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import {
  HISTORICAL_DATASET_MEMBERSHIP_V2,
  type HistoricalPreHoldoutDatasetMembershipV2,
} from "@/lib/trader/historical-simulation-v2/dataset-membership-v2";
import {
  assertHistoricalMarketCycleV2,
  type HistoricalSealedMarketCycleV2,
} from "@/lib/trader/historical-simulation-v2/modeled-execution-advance-v2";
import { withPostgresSessionTransactionV2 } from
  "@/lib/trader/historical-simulation-v2/postgres-session-transaction-v2";

import {
  assertKmComputeBudgetV1,
  computeKmGlobalAnchorSetDigest,
  computeKmSurfaceAnchorSetDigest,
  KM_GRID_K,
  KM_GRID_M,
  KM_REFERENCE_K,
  KM_REFERENCE_M,
  selectKmAnchorsV1,
  type KmEligibleAnchor,
} from "./km-convergence-gate-v1";
import {
  buildKmFourSurfaceContractV2,
  buildKmFourSurfaceDevelopmentAuthorityV2,
  buildKmSurfaceConvergenceReceiptFromReplayV2,
  type KmAnchorReplayEvidenceV2,
  type KmFourSurfaceContractV2,
} from "./km-four-surface-contract-v2";

export const KM_FOUR_SURFACE_PRODUCTION_AUTHORITY_V2 =
  "km-four-surface-production-authority/v2" as const;
export const KM_FOUR_SURFACE_EXECUTABLE_EVALUATOR_V2 =
  "km-four-surface-executable-evaluator/v2" as const;

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SURFACES = [
  { symbol: "BTCUSDT" as const, primaryHorizonMinutes: 30 as const },
  { symbol: "BTCUSDT" as const, primaryHorizonMinutes: 60 as const },
  { symbol: "ETHUSDT" as const, primaryHorizonMinutes: 30 as const },
  { symbol: "ETHUSDT" as const, primaryHorizonMinutes: 60 as const },
] as const;

export type KmFourSurfaceProductionEconomicsV2 = Readonly<{
  notionalUsdt: number;
  costRate: number;
  slippageBufferUsdt: number;
  nRefUsdt: number;
}>;

export type KmFourSurfaceProductionAuthorityV2 = Readonly<{
  schemaVersion: typeof KM_FOUR_SURFACE_PRODUCTION_AUTHORITY_V2;
  evaluatorVersion: typeof KM_FOUR_SURFACE_EXECUTABLE_EVALUATOR_V2;
  releaseSha: string;
  organizationId: string;
  sourceQualificationReceiptDigestHex: string;
  runtimeRequalificationReceiptDigestHex: string | null;
  developmentDatasetIdentityDigestHex: string;
  durableDatasetAuthority: KmFourSurfaceDurableDatasetAuthorityV2;
  economics: KmFourSurfaceProductionEconomicsV2;
  contract: KmFourSurfaceContractV2;
  contentDigestHex: string;
}>;

export type KmFourSurfaceProductionBootstrapInputV2 = Readonly<{
  runId: string;
  datasetRoot: string;
  qualificationReceiptPath: string;
  runtimeRequalificationReceiptPath?: string;
  releaseSha: string;
  organizationId: string;
  economics: KmFourSurfaceProductionEconomicsV2;
}>;

export type KmFourSurfaceDurableDatasetAuthorityV2 = Readonly<{
  organizationId: string;
  runId: string;
  qualificationReceiptDigestHex: string;
  authorityRowCount: number;
  cycleIds: readonly string[];
  developmentSymbols: readonly ["BTCUSDT", "ETHUSDT"];
  developmentPartitionRawSha256Hex: Readonly<Record<"BTCUSDT" | "ETHUSDT", string>>;
  authoritySetContentDigestHex: string;
}>;

type DurableDatasetAuthorityRow = Readonly<{
  id: string;
  organization_id: string;
  run_id: string;
  cycle_id: string;
  dataset_authority_class: string;
  dataset_authority_digest_hex: string;
  membership_content_digest_hex: string;
  sealed_cycle_content_digest_hex: string;
  membership_json: HistoricalPreHoldoutDatasetMembershipV2;
  sealed_cycle_json: HistoricalSealedMarketCycleV2;
  authority_content_digest_hex: string;
  schema_version: string;
}>;

type EvaluatorInput = Readonly<{
  family: ReturnType<typeof buildHistoricalForecastFamilyV2>;
  developmentCorpus: readonly SourceAnchor[];
  selectedAnchors: readonly KmEligibleAnchor[];
  economics: KmFourSurfaceProductionEconomicsV2;
}>;

type ProductionDependencies = Readonly<{
  loadDurableAuthority(input: Readonly<{
    organizationId: string;
    runId: string;
  }>): Promise<KmFourSurfaceDurableDatasetAuthorityV2>;
  readQualification(path: string): FhvPreHoldoutQualificationReceiptV1;
  assertQualification(receipt: FhvPreHoldoutQualificationReceiptV1): void;
  assertFiles(input: Readonly<{
    datasetRoot: string;
    receipt: FhvPreHoldoutQualificationReceiptV1;
  }>): void;
  readRuntimeRequalification(path: string): FhvPreHoldoutRuntimeRequalificationV1;
  loadCorpusSnapshot(input: Readonly<{
    datasetRoot: string;
    symbol: "BTCUSDT" | "ETHUSDT";
    primaryHorizonMinutes: 30 | 60;
  }>): Promise<HistoricalDevelopmentSourceCorpusSnapshotV2>;
  evaluate(input: EvaluatorInput): readonly KmAnchorReplayEvidenceV2[];
}>;

function refuseDurableAuthority(code: string): never {
  throw new Error(`KM_FOUR_SURFACE_PRODUCTION_REFUSED:DURABLE_AUTHORITY_${code}`);
}

function validateDurableDatasetAuthorityRowsV2(input: Readonly<{
  organizationId: string;
  runId: string;
  rows: readonly DurableDatasetAuthorityRow[];
}>): KmFourSurfaceDurableDatasetAuthorityV2 {
  if (!UUID.test(input.organizationId) || !input.runId.trim() || input.rows.length === 0) {
    refuseDurableAuthority("SCOPE");
  }
  const qualificationDigests = new Set<string>();
  const developmentSymbols = new Set<string>();
  const developmentRawDigests = new Map<"BTCUSDT" | "ETHUSDT", string>();
  const cycleIds = new Set<string>();
  const membershipLocations = new Set<string>();
  const bindings: Array<Readonly<{
    id: string;
    cycleId: string;
    membershipContentDigestHex: string;
    sealedCycleContentDigestHex: string;
    authorityContentDigestHex: string;
  }>> = [];

  for (const row of input.rows) {
    const membership = row.membership_json;
    const cycle = row.sealed_cycle_json;
    if (
      !UUID.test(row.id) || row.organization_id !== input.organizationId ||
      row.run_id !== input.runId || !row.cycle_id || cycleIds.has(row.cycle_id) ||
      row.dataset_authority_class !== "PRE_HOLDOUT_QUALIFICATION_V1" ||
      row.schema_version !== "waia.trader.historical_dataset_authority.v2" ||
      !DIGEST.test(row.dataset_authority_digest_hex) ||
      !DIGEST.test(row.membership_content_digest_hex) ||
      !DIGEST.test(row.sealed_cycle_content_digest_hex) ||
      !DIGEST.test(row.authority_content_digest_hex)
    ) {
      refuseDurableAuthority("ROW_ENVELOPE");
    }
    cycleIds.add(row.cycle_id);
    assertHistoricalMarketCycleV2(cycle, row.cycle_id);
    const membershipBody = { ...membership } as Record<string, unknown>;
    delete membershipBody.contentDigestHex;
    const location = `${membership.partition}:${membership.symbol}:${membership.recordIndex}`;
    if (
      membership.schemaVersion !== HISTORICAL_DATASET_MEMBERSHIP_V2 ||
      membership.organizationId !== input.organizationId ||
      membership.cycleId !== row.cycle_id ||
      membership.datasetAuthorityClass !== "PRE_HOLDOUT_QUALIFICATION_V1" ||
      membership.datasetAuthorityDigestHex !== row.dataset_authority_digest_hex ||
      membership.qualificationReceiptDigestHex !== row.dataset_authority_digest_hex ||
      membership.contentDigestHex !== row.membership_content_digest_hex ||
      computeSemanticSha256Hex(membershipBody) !== membership.contentDigestHex ||
      membership.sealedCycleContentDigestHex !== row.sealed_cycle_content_digest_hex ||
      cycle.contentDigestHex !== row.sealed_cycle_content_digest_hex ||
      membership.barContentDigestHex !== computeBarContentDigest(cycle.closedBar) ||
      !DIGEST.test(membership.partitionDigestHex) ||
      !DIGEST.test(membership.partitionRawSha256Hex) ||
      !Number.isSafeInteger(membership.recordIndex) || membership.recordIndex < 0 ||
      !(["DEVELOPMENT", "WALK_FORWARD"] as const).includes(membership.partition) ||
      !(["BTCUSDT", "ETHUSDT"] as const).includes(membership.symbol) ||
      membershipLocations.has(location)
    ) {
      refuseDurableAuthority("MEMBERSHIP");
    }
    membershipLocations.add(location);
    if (membership.partition === "DEVELOPMENT") {
      developmentSymbols.add(membership.symbol);
      const existingRawDigest = developmentRawDigests.get(membership.symbol);
      if (existingRawDigest && existingRawDigest !== membership.partitionRawSha256Hex) {
        refuseDurableAuthority("DEVELOPMENT_RAW_DIGEST_COHORT");
      }
      developmentRawDigests.set(membership.symbol, membership.partitionRawSha256Hex);
    }
    qualificationDigests.add(membership.qualificationReceiptDigestHex);
    if (
      computeStableJsonDigest({
        organizationId: input.organizationId,
        runId: input.runId,
        membership,
        sealedCycle: cycle,
      }) !== row.authority_content_digest_hex
    ) {
      refuseDurableAuthority("CONTENT_DIGEST");
    }
    bindings.push(Object.freeze({
      id: row.id,
      cycleId: row.cycle_id,
      membershipContentDigestHex: row.membership_content_digest_hex,
      sealedCycleContentDigestHex: row.sealed_cycle_content_digest_hex,
      authorityContentDigestHex: row.authority_content_digest_hex,
    }));
  }
  if (
    qualificationDigests.size !== 1 ||
    JSON.stringify([...developmentSymbols].sort()) !== JSON.stringify(["BTCUSDT", "ETHUSDT"])
  ) {
    refuseDurableAuthority("COHORT");
  }
  const qualificationReceiptDigestHex = [...qualificationDigests][0]!;
  const btcDevelopmentRawSha256Hex = developmentRawDigests.get("BTCUSDT");
  const ethDevelopmentRawSha256Hex = developmentRawDigests.get("ETHUSDT");
  if (!btcDevelopmentRawSha256Hex || !ethDevelopmentRawSha256Hex) {
    refuseDurableAuthority("DEVELOPMENT_RAW_DIGEST_COHORT");
  }
  const developmentPartitionRawSha256Hex = Object.freeze({
    BTCUSDT: btcDevelopmentRawSha256Hex,
    ETHUSDT: ethDevelopmentRawSha256Hex,
  });
  const sortedBindings = bindings.sort((left, right) =>
    left.cycleId.localeCompare(right.cycleId));
  const sortedCycleIds = Object.freeze(sortedBindings.map((binding) => binding.cycleId));
  const body = {
    schemaVersion: "km-four-surface-durable-dataset-authority/v2",
    organizationId: input.organizationId,
    runId: input.runId,
    qualificationReceiptDigestHex,
    developmentPartitionRawSha256Hex,
    authorityRows: sortedBindings,
  };
  return Object.freeze({
    organizationId: input.organizationId,
    runId: input.runId,
    qualificationReceiptDigestHex,
    authorityRowCount: bindings.length,
    cycleIds: sortedCycleIds,
    developmentSymbols: Object.freeze(["BTCUSDT", "ETHUSDT"] as const),
    developmentPartitionRawSha256Hex,
    authoritySetContentDigestHex: computeStableJsonDigest(body),
  });
}

async function loadDurableDatasetAuthorityWithSqlV2(input: Readonly<{
  sql: postgres.Sql;
  organizationId: string;
  runId: string;
}>): Promise<KmFourSurfaceDurableDatasetAuthorityV2> {
  return withPostgresSessionTransactionV2(input.sql, "REPEATABLE READ", async (tx) => {
    const rows = await tx<DurableDatasetAuthorityRow[]>`
      SELECT id::text, organization_id::text, run_id, cycle_id,
             dataset_authority_class, dataset_authority_digest_hex,
             membership_content_digest_hex, sealed_cycle_content_digest_hex,
             membership_json, sealed_cycle_json, authority_content_digest_hex, schema_version
      FROM trader_historical_dataset_authority_v2
      WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
        AND dataset_authority_class='PRE_HOLDOUT_QUALIFICATION_V1'
      ORDER BY cycle_id
      FOR SHARE
    `;
    return validateDurableDatasetAuthorityRowsV2({ ...input, rows });
  });
}

async function loadDurableDatasetAuthorityFromCanonicalPostgresV2(input: Readonly<{
  organizationId: string;
  runId: string;
}>): Promise<KmFourSurfaceDurableDatasetAuthorityV2> {
  return withWaiaPostgresClient((sql) =>
    loadDurableDatasetAuthorityWithSqlV2({ ...input, sql }));
}

const PRODUCTION_DEPENDENCIES: ProductionDependencies = Object.freeze({
  loadDurableAuthority: loadDurableDatasetAuthorityFromCanonicalPostgresV2,
  readQualification: readFhvPreHoldoutQualificationReceipt,
  assertQualification: assertFhvPreHoldoutQualificationPass,
  assertFiles: assertFhvPreHoldoutFilesMatchReceipt,
  readRuntimeRequalification: readFhvPreHoldoutRuntimeRequalification,
  loadCorpusSnapshot: loadHistoricalDevelopmentSourceCorpusSnapshotFromDatasetV2,
  evaluate: buildExecutableForecastReplayEvidenceV2,
});

function requireEconomics(
  input: KmFourSurfaceProductionEconomicsV2,
): KmFourSurfaceProductionEconomicsV2 {
  if (
    !Number.isFinite(input.notionalUsdt) || input.notionalUsdt <= 0 ||
    !Number.isFinite(input.costRate) || input.costRate < 0 ||
    !Number.isFinite(input.slippageBufferUsdt) || input.slippageBufferUsdt < 0 ||
    !Number.isFinite(input.nRefUsdt) || input.nRefUsdt <= 0
  ) {
    throw new Error("KM_FOUR_SURFACE_PRODUCTION_REFUSED:ECONOMICS");
  }
  return Object.freeze({ ...input });
}

function prefixSamples(
  samples: number[][][],
  kConfig: number,
  mConfig: number,
): number[][][] {
  return samples.slice(0, kConfig).map((replica) => replica.slice(0, mConfig));
}

function replayMetric(input: Readonly<{
  samples: number[][][];
  referenceSample: readonly number[];
  economics: KmFourSurfaceProductionEconomicsV2;
}>) {
  const means = computeReplicaPayoffMeans({
    notionalUsdt: input.economics.notionalUsdt,
    costRate: input.economics.costRate,
    slippageBufferUsdt: input.economics.slippageBufferUsdt,
    replicaSamples: input.samples,
  });
  const ev = computeDecisionEvRangeV1({
    muBaseReplicas: means.muBaseReplicas,
    muLowerReplicas: means.muLowerReplicas,
    scientificAdmissionVerified: false,
  });
  return Object.freeze({
    evLower: ev.evLower / input.economics.nRefUsdt,
    evBase: ev.evBase / input.economics.nRefUsdt,
    evUpper: ev.evUpper / input.economics.nRefUsdt,
    mcEs: energyMcFromNestedCubeV1(input.samples, input.referenceSample),
  });
}

/** Frozen production evaluator: identical K50/M80 reference and nested-prefix cells to V1. */
export function buildExecutableForecastReplayEvidenceV2(
  input: EvaluatorInput,
): readonly KmAnchorReplayEvidenceV2[] {
  assertKmComputeBudgetV1();
  const pkg = buildPredictivePackageV1({
    family: input.family,
    sourceCorpus: input.developmentCorpus,
    kConfigDec: KM_REFERENCE_K,
    mConfigDec: KM_REFERENCE_M,
  });
  const sourceByEpoch = new Map(
    input.developmentCorpus.map((source) => [source.closedBarEpochMs / 60_000, source]),
  );
  return Object.freeze(input.selectedAnchors.map((anchor) => {
    const source = sourceByEpoch.get(anchor.anchorEpochMin);
    if (!source) throw new Error("KM_FOUR_SURFACE_PRODUCTION_REFUSED:SELECTED_SOURCE");
    const issuance = issueForecastV1({
      pkg,
      anchorClosedBarEpochMs: source.closedBarEpochMs,
      anchorRealizedVol20m_1m: source.realizedVol20m_1m,
      executionHorizonMinutes: input.family.executionHorizonMinutes,
      normalizationVersionDigestHex: input.family.normalizationVersionDigestHex,
    });
    const referenceSample = issuance.samples[0]?.[0];
    if (!referenceSample) throw new Error("KM_FOUR_SURFACE_PRODUCTION_REFUSED:EMPTY_REFERENCE");
    const reference = replayMetric({
      samples: issuance.samples,
      referenceSample,
      economics: input.economics,
    });
    const cells = KM_GRID_K.flatMap((kConfig) =>
      KM_GRID_M.map((mConfig) => Object.freeze({
        kConfig,
        mConfig,
        candidate: replayMetric({
          samples: prefixSamples(issuance.samples, kConfig, mConfig),
          referenceSample,
          economics: input.economics,
        }),
      })),
    );
    return Object.freeze({
      anchorEpochMin: anchor.anchorEpochMin,
      reference,
      cells: Object.freeze(cells),
    });
  }));
}

function validateQualification(input: Readonly<{
  config: KmFourSurfaceProductionBootstrapInputV2;
  deps: ProductionDependencies;
  durableAuthority: KmFourSurfaceDurableDatasetAuthorityV2;
}>): Readonly<{
  receipt: FhvPreHoldoutQualificationReceiptV1;
  releaseSha: string;
  runtimeReceipt: FhvPreHoldoutRuntimeRequalificationV1 | null;
}> {
  const releaseSha = input.config.releaseSha.trim().toLowerCase();
  if (!SHA.test(releaseSha)) throw new Error("KM_FOUR_SURFACE_PRODUCTION_REFUSED:RELEASE");
  const receipt = input.deps.readQualification(input.config.qualificationReceiptPath);
  input.deps.assertQualification(receipt);
  const developmentSymbols = receipt.partitions
    .filter((partition) => partition.partition === "development")
    .map((partition) => partition.symbol)
    .sort();
  if (
    receipt.organizationId !== input.config.organizationId ||
    receipt.qualificationReceiptDigest !==
      input.durableAuthority.qualificationReceiptDigestHex ||
    receipt.holdout.status !== "PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED" ||
    !DIGEST.test(receipt.qualificationReceiptDigest) ||
    !DIGEST.test(receipt.developmentContentDigest) ||
    JSON.stringify(developmentSymbols) !== JSON.stringify(["BTCUSDT", "ETHUSDT"])
  ) {
    throw new Error("KM_FOUR_SURFACE_PRODUCTION_REFUSED:QUALIFICATION_SCOPE");
  }
  input.deps.assertFiles({ datasetRoot: input.config.datasetRoot, receipt });
  let runtimeReceipt: FhvPreHoldoutRuntimeRequalificationV1 | null = null;
  if (receipt.releaseSha !== releaseSha || input.config.runtimeRequalificationReceiptPath) {
    if (!input.config.runtimeRequalificationReceiptPath) {
      throw new Error("KM_FOUR_SURFACE_PRODUCTION_REFUSED:RUNTIME_REQUALIFICATION_REQUIRED");
    }
    runtimeReceipt = input.deps.readRuntimeRequalification(
      input.config.runtimeRequalificationReceiptPath,
    );
    if (
      runtimeReceipt.sourceQualificationReceiptDigest !== receipt.qualificationReceiptDigest ||
      runtimeReceipt.sourceReleaseSha !== receipt.releaseSha ||
      runtimeReceipt.targetReleaseSha !== releaseSha ||
      runtimeReceipt.datasetContentDigest !== receipt.developmentWalkForwardContentDigest ||
      runtimeReceipt.organizationId !== receipt.organizationId ||
      !DIGEST.test(runtimeReceipt.requalificationReceiptDigest)
    ) {
      throw new Error("KM_FOUR_SURFACE_PRODUCTION_REFUSED:RUNTIME_REQUALIFICATION_SCOPE");
    }
  }
  return Object.freeze({ receipt, releaseSha, runtimeReceipt });
}

function reverifyQualifiedFilesAfterCorpusBuild(input: Readonly<{
  config: KmFourSurfaceProductionBootstrapInputV2;
  deps: ProductionDependencies;
  durableAuthority: KmFourSurfaceDurableDatasetAuthorityV2;
}>): void {
  const receipt = input.deps.readQualification(input.config.qualificationReceiptPath);
  input.deps.assertQualification(receipt);
  if (
    receipt.qualificationReceiptDigest !==
      input.durableAuthority.qualificationReceiptDigestHex ||
    receipt.organizationId !== input.config.organizationId ||
    receipt.holdout.status !== "PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED"
  ) {
    throw new Error("KM_FOUR_SURFACE_PRODUCTION_REFUSED:POST_CORPUS_FILE_AUTHORITY");
  }
  input.deps.assertFiles({ datasetRoot: input.config.datasetRoot, receipt });
}

function selectSurfaceAnchors(input: Readonly<{
  family: ReturnType<typeof buildHistoricalForecastFamilyV2>;
  corpus: readonly SourceAnchor[];
}>): readonly KmEligibleAnchor[] {
  return selectKmAnchorsV1({
    developmentDatasetDigestRaw32: Buffer.from(input.family.developmentDatasetDigestHex, "hex"),
    symbol: input.family.symbol,
    primaryHorizonMinutes: input.family.primaryHorizonMinutes as 30 | 60,
    eligibleAnchors: input.corpus.map((source) => ({
      symbol: input.family.symbol,
      primaryHorizonMinutes: input.family.primaryHorizonMinutes as 30 | 60,
      anchorEpochMin: source.closedBarEpochMs / 60_000,
    })),
  });
}

async function buildProductionAuthorityInternal(
  config: KmFourSurfaceProductionBootstrapInputV2,
  deps: ProductionDependencies,
): Promise<KmFourSurfaceProductionAuthorityV2> {
  const durableAuthority = await deps.loadDurableAuthority({
    organizationId: config.organizationId,
    runId: config.runId,
  });
  if (
    durableAuthority.organizationId !== config.organizationId ||
    durableAuthority.runId !== config.runId ||
    !Number.isSafeInteger(durableAuthority.authorityRowCount) ||
    !Array.isArray(durableAuthority.cycleIds) ||
    durableAuthority.authorityRowCount !== durableAuthority.cycleIds.length ||
    new Set(durableAuthority.cycleIds).size !== durableAuthority.cycleIds.length ||
    durableAuthority.cycleIds.some((cycleId) => !cycleId.trim()) ||
    JSON.stringify(durableAuthority.developmentSymbols) !==
      JSON.stringify(["BTCUSDT", "ETHUSDT"]) ||
    !DIGEST.test(durableAuthority.qualificationReceiptDigestHex) ||
    !DIGEST.test(durableAuthority.authoritySetContentDigestHex)
  ) {
    throw new Error("KM_FOUR_SURFACE_PRODUCTION_REFUSED:DURABLE_AUTHORITY_SCOPE");
  }
  const qualification = validateQualification({ config, deps, durableAuthority });
  const economics = requireEconomics(config.economics);
  const loaded = await Promise.all(SURFACES.map(async (surface) => {
    const family = buildHistoricalForecastFamilyV2({
      organizationId: config.organizationId,
      symbol: surface.symbol,
      primaryHorizonMinutes: surface.primaryHorizonMinutes,
      developmentDatasetDigestHex: qualification.receipt.developmentContentDigest,
      releaseSha: qualification.releaseSha,
    });
    const snapshot = await deps.loadCorpusSnapshot({
      datasetRoot: config.datasetRoot,
      symbol: surface.symbol,
      primaryHorizonMinutes: surface.primaryHorizonMinutes,
    });
    const receiptPartition = qualification.receipt.partitions.find((partition) =>
      partition.partition === "development" && partition.symbol === surface.symbol);
    const durableRawSha256Hex =
      durableAuthority.developmentPartitionRawSha256Hex[surface.symbol];
    if (
      !receiptPartition ||
      !DIGEST.test(snapshot.rawSha256Hex) ||
      snapshot.rawSha256Hex !== receiptPartition.rawSha256 ||
      snapshot.rawSha256Hex !== durableRawSha256Hex
    ) {
      throw new Error("KM_FOUR_SURFACE_PRODUCTION_REFUSED:CORPUS_RAW_AUTHORITY");
    }
    return Object.freeze({ family, developmentCorpus: snapshot.corpus });
  }));
  reverifyQualifiedFilesAfterCorpusBuild({ config, deps, durableAuthority });
  const developmentAuthority = buildKmFourSurfaceDevelopmentAuthorityV2({
    organizationId: config.organizationId,
    datasetAuthorityIdentityDigestHex: qualification.receipt.developmentContentDigest,
    surfaces: loaded,
  });
  const selected = loaded.map((surface) => selectSurfaceAnchors({
    family: surface.family,
    corpus: surface.developmentCorpus,
  }));
  const surfaceDigests = loaded.map((surface, index) =>
    computeKmSurfaceAnchorSetDigest({
      developmentDatasetDigestRaw32: Buffer.from(
        qualification.receipt.developmentContentDigest,
        "hex",
      ),
      symbol: surface.family.symbol,
      primaryHorizonMinutes: surface.family.primaryHorizonMinutes,
      anchors: selected[index]!,
    }),
  );
  const globalAnchorSetDigestHex =
    computeKmGlobalAnchorSetDigest(surfaceDigests).toString("hex");
  const contractSurfaces = loaded.map((surface, index) => {
    const replayEvidence = deps.evaluate({
      family: surface.family,
      developmentCorpus: surface.developmentCorpus,
      selectedAnchors: selected[index]!,
      economics,
    });
    const replay = buildKmSurfaceConvergenceReceiptFromReplayV2({
      family: surface.family,
      developmentCorpus: surface.developmentCorpus,
      selectedAnchors: selected[index]!,
      replayEvidence,
      globalAnchorSetDigestHex,
    });
    return Object.freeze({
      family: surface.family,
      developmentCorpus: surface.developmentCorpus,
      replayEvidence,
      replayEvidenceContentDigestHex: replay.replayEvidenceContentDigestHex,
      convergenceReceipt: replay.receipt,
    });
  });
  const contract = buildKmFourSurfaceContractV2({
    developmentAuthority,
    surfaces: contractSurfaces,
  });
  const body = {
    schemaVersion: KM_FOUR_SURFACE_PRODUCTION_AUTHORITY_V2,
    evaluatorVersion: KM_FOUR_SURFACE_EXECUTABLE_EVALUATOR_V2,
    releaseSha: qualification.releaseSha,
    organizationId: config.organizationId,
    sourceQualificationReceiptDigestHex: qualification.receipt.qualificationReceiptDigest,
    runtimeRequalificationReceiptDigestHex:
      qualification.runtimeReceipt?.requalificationReceiptDigest ?? null,
    developmentDatasetIdentityDigestHex: qualification.receipt.developmentContentDigest,
    durableDatasetAuthority: durableAuthority,
    economics,
    contract,
  };
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

/** Production entrypoint: dependencies and all evidence-producing inputs are closed. */
export function buildKmFourSurfaceProductionAuthorityV2(
  input: KmFourSurfaceProductionBootstrapInputV2,
): Promise<KmFourSurfaceProductionAuthorityV2> {
  return buildProductionAuthorityInternal(input, PRODUCTION_DEPENDENCIES);
}

/** Internal production composition: the caller already owns the run-scoped session lock. */
export function buildKmFourSurfaceProductionAuthorityWithHeldPostgresV2(
  input: KmFourSurfaceProductionBootstrapInputV2,
  sql: postgres.Sql,
): Promise<KmFourSurfaceProductionAuthorityV2> {
  return buildProductionAuthorityInternal(input, {
    ...PRODUCTION_DEPENDENCIES,
    loadDurableAuthority: (scope) =>
      loadDurableDatasetAuthorityWithSqlV2({ ...scope, sql }),
  });
}

/** TEST_ONLY dependency seam; intentionally not re-exported from the qualification index. */
export function TEST_ONLY_buildKmFourSurfaceProductionAuthorityV2(
  input: KmFourSurfaceProductionBootstrapInputV2,
  dependencies: ProductionDependencies,
): Promise<KmFourSurfaceProductionAuthorityV2> {
  if (process.env.NODE_ENV !== "test" || process.env.VITEST !== "true") {
    throw new Error("KM_FOUR_SURFACE_PRODUCTION_REFUSED:TEST_ONLY_RUNTIME");
  }
  return buildProductionAuthorityInternal(input, dependencies);
}

/** TEST_ONLY durable-read seam; intentionally not re-exported from the qualification index. */
export function TEST_ONLY_loadKmFourSurfaceDurableDatasetAuthorityV2(
  sql: postgres.Sql,
  input: Readonly<{ organizationId: string; runId: string }>,
): Promise<KmFourSurfaceDurableDatasetAuthorityV2> {
  if (process.env.NODE_ENV !== "test" || process.env.VITEST !== "true") {
    throw new Error("KM_FOUR_SURFACE_PRODUCTION_REFUSED:TEST_ONLY_RUNTIME");
  }
  return loadDurableDatasetAuthorityWithSqlV2({ ...input, sql });
}
