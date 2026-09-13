import { createHash } from "node:crypto";
import { types } from "node:util";

export const G1_MAPPING_SCHEMA_V1 = "waia.trader.g1_trusted_origin_mapping.v1" as const;
export const G1_MAPPING_ENVELOPE_SCHEMA_V1 =
  "waia.trader.g1_trusted_origin_mapping_envelope.v1" as const;
export const WF_FORECAST_BATCH_STAGE_V1 = "wf-forecast-batch-v1" as const;
export const WF_FORECAST_BATCH_SIZE_V1 = 32 as const;

const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const fail = (reason: string): never => {
  throw new Error(`G1_TRUSTED_ORIGIN_MAPPING_REFUSED:${reason}`);
};
function dataObject(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length ||
    Object.keys(value).sort().join(",") !== [...keys].sort().join(",")
  )
    fail("OBJECT");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) fail("ACCESSOR");
  }
}
function denseArray(value: unknown): asserts value is unknown[] {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length ||
    Object.keys(value).length !== value.length ||
    Object.getOwnPropertyNames(value).length !== value.length + 1
  )
    fail("ARRAY");
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !("value" in descriptor)) fail("ARRAY");
  }
}
const digest64 = (value: unknown): value is string =>
  typeof value === "string" && HEX64.test(value);
const digest40 = (value: unknown): value is string =>
  typeof value === "string" && HEX40.test(value);
function runtime(value: unknown): { node: string; os: string; arch: string } {
  dataObject(value, ["arch", "node", "os"]);
  if (
    typeof value.node !== "string" ||
    typeof value.os !== "string" ||
    typeof value.arch !== "string" ||
    !/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value.node) ||
    !/^[a-z0-9_]+$/.test(value.os) ||
    !/^[a-z0-9_]+$/.test(value.arch)
  )
    fail("RUNTIME");
  return Object.freeze({ node: value.node, os: value.os, arch: value.arch });
}

export function mappingContentDigestHexV1(mapping: unknown): string {
  return createHash("sha256").update(JSON.stringify(mapping), "utf8").digest("hex");
}

export type G1SelectedPackageV1 = {
  chunkCount: number;
  contentDigestHex: string;
  generationDigestHex: string;
  packageKey: string;
  runtimeContractDigestHex: string;
  selectionRule: string;
  sourceCount: number;
  targetGridDigestHex: string;
};
export type G1ExpectedWfForecastBatchDomainV1 = {
  authenticatedMatchingBatches: number;
  batchSize: typeof WF_FORECAST_BATCH_SIZE_V1;
  expectedAnchors: number;
  expectedBatches: number;
  expectedKeyOrderDigest: string;
  lastBatchAnchorCount: number;
  missingBatches: number;
  offsets: { endExclusive: number; start: number; step: typeof WF_FORECAST_BATCH_SIZE_V1 };
  stage: typeof WF_FORECAST_BATCH_STAGE_V1;
  wfStatus: string;
};
export type G1TrustedOriginSurfaceV1 = {
  development: { datasetDigestHex: string; rawSha256Hex: string; sourceCount: number };
  evaluationPartition: {
    qualificationReceiptDigestHex: string;
    receiptDigestHex: string;
    walkForwardRawSha256Hex: string;
  };
  expectedWfForecastBatchDomain: G1ExpectedWfForecastBatchDomainV1;
  kmSelection: { k: number; kmBindingStatus: string; m: number; surfaceAnchorSetDigestHex: string };
  market: "spot";
  origin: { releaseSha: string; runtime: { node: string; os: string; arch: string } };
  primaryHorizonMinutes: 30 | 60;
  selectedPackage: G1SelectedPackageV1;
  surfaceKey: "BTCUSDT:30" | "BTCUSDT:60" | "ETHUSDT:30" | "ETHUSDT:60";
  symbol: "BTCUSDT" | "ETHUSDT";
  venue: "htx";
};
export type G1TrustedOriginMappingV1 = {
  O: {
    organizationId: string;
    releaseSha: string;
    runId: string;
    runtime: { node: string; os: string; arch: string };
  };
  S0: string;
  authorityGranted: false;
  dataset: {
    datasetContentDigest: string;
    originRuntimeRequalificationDigest: string;
    qualificationReceiptDigestHex: string;
    root: string;
  };
  generationAuthority: "NOT_GRANTED";
  provenance: Record<string, unknown>;
  schemaVersion: typeof G1_MAPPING_SCHEMA_V1;
  scientificAdmission: "NOT_GRANTED";
  sealedAtUtc: string;
  serverWrite: "NOT_PERFORMED";
  surfaces: readonly G1TrustedOriginSurfaceV1[];
  totals: {
    missingForecastBatches: number;
    missingForecastRows: number;
    originCompleteForecastBatches: number;
  };
  unselectedDuplicatePackageKeys: readonly unknown[];
};
export type G1TrustedOriginMappingEnvelopeV1 = {
  authorityGranted: false;
  contentDigestHex: string;
  mapping: G1TrustedOriginMappingV1;
  schemaVersion: typeof G1_MAPPING_ENVELOPE_SCHEMA_V1;
};

function parseSelectedPackage(value: unknown): G1SelectedPackageV1 {
  dataObject(value, [
    "chunkCount",
    "contentDigestHex",
    "generationDigestHex",
    "packageKey",
    "runtimeContractDigestHex",
    "selectionRule",
    "sourceCount",
    "targetGridDigestHex",
  ]);
  if (
    !Number.isSafeInteger(value.chunkCount) ||
    value.chunkCount < 1 ||
    !digest64(value.contentDigestHex) ||
    !digest64(value.generationDigestHex) ||
    !digest64(value.packageKey) ||
    !digest64(value.runtimeContractDigestHex) ||
    typeof value.selectionRule !== "string" ||
    !value.selectionRule ||
    !Number.isSafeInteger(value.sourceCount) ||
    value.sourceCount < 1 ||
    !digest64(value.targetGridDigestHex)
  )
    fail("SELECTED_PACKAGE");
  return Object.freeze({
    chunkCount: value.chunkCount,
    contentDigestHex: value.contentDigestHex,
    generationDigestHex: value.generationDigestHex,
    packageKey: value.packageKey,
    runtimeContractDigestHex: value.runtimeContractDigestHex,
    selectionRule: value.selectionRule,
    sourceCount: value.sourceCount,
    targetGridDigestHex: value.targetGridDigestHex,
  });
}

function parseDomain(value: unknown): G1ExpectedWfForecastBatchDomainV1 {
  dataObject(value, [
    "authenticatedMatchingBatches",
    "batchSize",
    "expectedAnchors",
    "expectedBatches",
    "expectedKeyOrderDigest",
    "lastBatchAnchorCount",
    "missingBatches",
    "offsets",
    "stage",
    "wfStatus",
  ]);
  dataObject(value.offsets, ["endExclusive", "start", "step"]);
  const offsets = value.offsets as Record<string, unknown>;
  if (!Number.isSafeInteger(value.expectedAnchors) || value.expectedAnchors < 1)
    fail("BATCH_DOMAIN");
  const expectedBatches = Math.ceil(value.expectedAnchors / WF_FORECAST_BATCH_SIZE_V1);
  const lastBatchAnchorCount =
    value.expectedAnchors % WF_FORECAST_BATCH_SIZE_V1 || WF_FORECAST_BATCH_SIZE_V1;
  if (
    value.batchSize !== WF_FORECAST_BATCH_SIZE_V1 ||
    value.stage !== WF_FORECAST_BATCH_STAGE_V1 ||
    !digest64(value.expectedKeyOrderDigest) ||
    typeof value.wfStatus !== "string" ||
    !value.wfStatus ||
    value.expectedBatches !== expectedBatches ||
    value.lastBatchAnchorCount !== lastBatchAnchorCount ||
    !Number.isSafeInteger(value.missingBatches) ||
    value.missingBatches < 0 ||
    !Number.isSafeInteger(value.authenticatedMatchingBatches) ||
    value.authenticatedMatchingBatches < 0 ||
    offsets.start !== 0 ||
    offsets.step !== WF_FORECAST_BATCH_SIZE_V1 ||
    !Number.isSafeInteger(offsets.endExclusive) ||
    offsets.endExclusive !== value.expectedAnchors ||
    value.authenticatedMatchingBatches + value.missingBatches !== value.expectedBatches
  )
    fail("BATCH_DOMAIN");
  return Object.freeze({
    authenticatedMatchingBatches: value.authenticatedMatchingBatches,
    batchSize: WF_FORECAST_BATCH_SIZE_V1,
    expectedAnchors: value.expectedAnchors,
    expectedBatches: value.expectedBatches,
    expectedKeyOrderDigest: value.expectedKeyOrderDigest,
    lastBatchAnchorCount: value.lastBatchAnchorCount,
    missingBatches: value.missingBatches,
    offsets: Object.freeze({
      endExclusive: offsets.endExclusive as number,
      start: 0,
      step: WF_FORECAST_BATCH_SIZE_V1,
    }),
    stage: WF_FORECAST_BATCH_STAGE_V1,
    wfStatus: value.wfStatus,
  });
}

function parseSurface(value: unknown): G1TrustedOriginSurfaceV1 {
  dataObject(value, [
    "development",
    "evaluationPartition",
    "expectedWfForecastBatchDomain",
    "kmSelection",
    "market",
    "origin",
    "primaryHorizonMinutes",
    "selectedPackage",
    "surfaceKey",
    "symbol",
    "venue",
  ]);
  dataObject(value.development, ["datasetDigestHex", "rawSha256Hex", "sourceCount"]);
  dataObject(value.evaluationPartition, [
    "qualificationReceiptDigestHex",
    "receiptDigestHex",
    "walkForwardRawSha256Hex",
  ]);
  dataObject(value.kmSelection, ["k", "kmBindingStatus", "m", "surfaceAnchorSetDigestHex"]);
  dataObject(value.origin, ["releaseSha", "runtime"]);
  const originRuntime = runtime(value.origin.runtime);
  if (
    value.venue !== "htx" ||
    value.market !== "spot" ||
    (value.symbol !== "BTCUSDT" && value.symbol !== "ETHUSDT") ||
    (value.primaryHorizonMinutes !== 30 && value.primaryHorizonMinutes !== 60) ||
    value.surfaceKey !== `${value.symbol}:${value.primaryHorizonMinutes}` ||
    !digest40(value.origin.releaseSha) ||
    !digest64(value.development.datasetDigestHex) ||
    !digest64(value.development.rawSha256Hex) ||
    !Number.isSafeInteger(value.development.sourceCount) ||
    value.development.sourceCount < 1 ||
    !digest64(value.evaluationPartition.qualificationReceiptDigestHex) ||
    !digest64(value.evaluationPartition.receiptDigestHex) ||
    !digest64(value.evaluationPartition.walkForwardRawSha256Hex) ||
    !Number.isSafeInteger(value.kmSelection.k) ||
    value.kmSelection.k < 1 ||
    !Number.isSafeInteger(value.kmSelection.m) ||
    value.kmSelection.m < 1 ||
    typeof value.kmSelection.kmBindingStatus !== "string" ||
    !digest64(value.kmSelection.surfaceAnchorSetDigestHex)
  )
    fail("SURFACE");
  return Object.freeze({
    development: Object.freeze({
      datasetDigestHex: value.development.datasetDigestHex,
      rawSha256Hex: value.development.rawSha256Hex,
      sourceCount: value.development.sourceCount,
    }),
    evaluationPartition: Object.freeze({
      qualificationReceiptDigestHex: value.evaluationPartition.qualificationReceiptDigestHex,
      receiptDigestHex: value.evaluationPartition.receiptDigestHex,
      walkForwardRawSha256Hex: value.evaluationPartition.walkForwardRawSha256Hex,
    }),
    expectedWfForecastBatchDomain: parseDomain(value.expectedWfForecastBatchDomain),
    kmSelection: Object.freeze({
      k: value.kmSelection.k,
      kmBindingStatus: value.kmSelection.kmBindingStatus,
      m: value.kmSelection.m,
      surfaceAnchorSetDigestHex: value.kmSelection.surfaceAnchorSetDigestHex,
    }),
    market: "spot",
    origin: Object.freeze({ releaseSha: value.origin.releaseSha, runtime: originRuntime }),
    primaryHorizonMinutes: value.primaryHorizonMinutes,
    selectedPackage: parseSelectedPackage(value.selectedPackage),
    surfaceKey: value.surfaceKey,
    symbol: value.symbol,
    venue: "htx",
  });
}

/** Schema for the sealed G1 mapping envelope. Grants no generation or admission authority. */
export function parseG1TrustedOriginMappingEnvelopeV1(
  value: unknown,
): G1TrustedOriginMappingEnvelopeV1 {
  dataObject(value, ["authorityGranted", "contentDigestHex", "mapping", "schemaVersion"]);
  if (
    value.authorityGranted !== false ||
    value.schemaVersion !== G1_MAPPING_ENVELOPE_SCHEMA_V1 ||
    !digest64(value.contentDigestHex)
  )
    fail("ENVELOPE");
  if (mappingContentDigestHexV1(value.mapping) !== value.contentDigestHex) fail("CONTENT_DIGEST");
  dataObject(value.mapping, [
    "O",
    "S0",
    "authorityGranted",
    "dataset",
    "generationAuthority",
    "provenance",
    "schemaVersion",
    "scientificAdmission",
    "sealedAtUtc",
    "serverWrite",
    "surfaces",
    "totals",
    "unselectedDuplicatePackageKeys",
  ]);
  const mapping = value.mapping;
  dataObject(mapping.O, ["organizationId", "releaseSha", "runId", "runtime"]);
  dataObject(mapping.dataset, [
    "datasetContentDigest",
    "originRuntimeRequalificationDigest",
    "qualificationReceiptDigestHex",
    "root",
  ]);
  dataObject(mapping.totals, [
    "missingForecastBatches",
    "missingForecastRows",
    "originCompleteForecastBatches",
  ]);
  if (
    mapping.authorityGranted !== false ||
    mapping.generationAuthority !== "NOT_GRANTED" ||
    mapping.scientificAdmission !== "NOT_GRANTED" ||
    mapping.serverWrite !== "NOT_PERFORMED" ||
    mapping.schemaVersion !== G1_MAPPING_SCHEMA_V1 ||
    !digest40(mapping.S0) ||
    typeof mapping.O.organizationId !== "string" ||
    !mapping.O.organizationId.trim() ||
    !digest40(mapping.O.releaseSha) ||
    typeof mapping.O.runId !== "string" ||
    !mapping.O.runId.trim() ||
    typeof mapping.sealedAtUtc !== "string" ||
    !mapping.sealedAtUtc ||
    !digest64(mapping.dataset.datasetContentDigest) ||
    !digest64(mapping.dataset.originRuntimeRequalificationDigest) ||
    !digest64(mapping.dataset.qualificationReceiptDigestHex) ||
    typeof mapping.dataset.root !== "string" ||
    !mapping.dataset.root ||
    !Number.isSafeInteger(mapping.totals.missingForecastBatches) ||
    mapping.totals.missingForecastBatches < 0 ||
    !Number.isSafeInteger(mapping.totals.missingForecastRows) ||
    mapping.totals.missingForecastRows < 0 ||
    !Number.isSafeInteger(mapping.totals.originCompleteForecastBatches) ||
    mapping.totals.originCompleteForecastBatches < 0
  )
    fail("MAPPING");
  denseArray(mapping.surfaces);
  denseArray(mapping.unselectedDuplicatePackageKeys);
  if (!mapping.surfaces.length) fail("SURFACES");
  const originRuntime = runtime(mapping.O.runtime);
  const surfaces = mapping.surfaces.map(parseSurface);
  const seen = new Set<string>();
  for (const surface of surfaces) {
    if (seen.has(surface.surfaceKey) || surface.origin.releaseSha !== mapping.O.releaseSha)
      fail("SURFACE_IDENTITY");
    seen.add(surface.surfaceKey);
  }
  return Object.freeze({
    authorityGranted: false,
    contentDigestHex: value.contentDigestHex,
    schemaVersion: G1_MAPPING_ENVELOPE_SCHEMA_V1,
    mapping: Object.freeze({
      O: Object.freeze({
        organizationId: mapping.O.organizationId,
        releaseSha: mapping.O.releaseSha,
        runId: mapping.O.runId,
        runtime: originRuntime,
      }),
      S0: mapping.S0,
      authorityGranted: false as const,
      dataset: Object.freeze({
        datasetContentDigest: mapping.dataset.datasetContentDigest,
        originRuntimeRequalificationDigest: mapping.dataset.originRuntimeRequalificationDigest,
        qualificationReceiptDigestHex: mapping.dataset.qualificationReceiptDigestHex,
        root: mapping.dataset.root,
      }),
      generationAuthority: "NOT_GRANTED",
      provenance: Object.freeze({ ...mapping.provenance }),
      schemaVersion: G1_MAPPING_SCHEMA_V1,
      scientificAdmission: "NOT_GRANTED",
      sealedAtUtc: mapping.sealedAtUtc,
      serverWrite: "NOT_PERFORMED",
      surfaces: Object.freeze(surfaces),
      totals: Object.freeze({
        missingForecastBatches: mapping.totals.missingForecastBatches,
        missingForecastRows: mapping.totals.missingForecastRows,
        originCompleteForecastBatches: mapping.totals.originCompleteForecastBatches,
      }),
      unselectedDuplicatePackageKeys: Object.freeze([...mapping.unselectedDuplicatePackageKeys]),
    }),
  });
}
