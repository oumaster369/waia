import { createHash } from "node:crypto";
import { types } from "node:util";

export const G1_MAPPING_SCHEMA_V1 = "waia.trader.g1_trusted_origin_mapping.v1" as const;
export const G1_MAPPING_ENVELOPE_SCHEMA_V1 =
  "waia.trader.g1_trusted_origin_mapping_envelope.v1" as const;
export const WF_FORECAST_BATCH_STAGE_V1 = "wf-forecast-batch-v1" as const;
export const WF_FORECAST_BATCH_SIZE_V1 = 32 as const;

const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
function fail(reason: string): never {
  throw new Error(`G1_TRUSTED_ORIGIN_MAPPING_REFUSED:${reason}`);
}
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
  if (!Array.isArray(value)) fail("ARRAY");
  if (
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
function int(value: unknown, reason: string, min?: number): number {
  if (typeof value !== "number") fail(reason);
  if (!Number.isSafeInteger(value)) fail(reason);
  if (min !== undefined && value < min) fail(reason);
  return value;
}
function str(value: unknown, reason: string): string {
  if (typeof value !== "string") fail(reason);
  if (!value) fail(reason);
  return value;
}
function hex64(value: unknown, reason: string): string {
  if (typeof value !== "string") fail(reason);
  if (!HEX64.test(value)) fail(reason);
  return value;
}
function hex40(value: unknown, reason: string): string {
  if (typeof value !== "string") fail(reason);
  if (!HEX40.test(value)) fail(reason);
  return value;
}
function runtime(value: unknown): { node: string; os: string; arch: string } {
  dataObject(value, ["arch", "node", "os"]);
  const node = str(value.node, "RUNTIME");
  const os = str(value.os, "RUNTIME");
  const arch = str(value.arch, "RUNTIME");
  if (
    !/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(node) ||
    !/^[a-z0-9_]+$/.test(os) ||
    !/^[a-z0-9_]+$/.test(arch)
  )
    fail("RUNTIME");
  return Object.freeze({ node, os, arch });
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
  const chunkCount = int(value.chunkCount, "SELECTED_PACKAGE", 1);
  const sourceCount = int(value.sourceCount, "SELECTED_PACKAGE", 1);
  const contentDigestHex = hex64(value.contentDigestHex, "SELECTED_PACKAGE");
  const generationDigestHex = hex64(value.generationDigestHex, "SELECTED_PACKAGE");
  const packageKey = hex64(value.packageKey, "SELECTED_PACKAGE");
  const runtimeContractDigestHex = hex64(value.runtimeContractDigestHex, "SELECTED_PACKAGE");
  const selectionRule = str(value.selectionRule, "SELECTED_PACKAGE");
  const targetGridDigestHex = hex64(value.targetGridDigestHex, "SELECTED_PACKAGE");
  return Object.freeze({
    chunkCount,
    contentDigestHex,
    generationDigestHex,
    packageKey,
    runtimeContractDigestHex,
    selectionRule,
    sourceCount,
    targetGridDigestHex,
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
  const offsets = value.offsets;
  const expectedAnchors = int(value.expectedAnchors, "BATCH_DOMAIN", 1);
  const expectedBatches = Math.ceil(expectedAnchors / WF_FORECAST_BATCH_SIZE_V1);
  const lastBatchAnchorCount =
    expectedAnchors % WF_FORECAST_BATCH_SIZE_V1 || WF_FORECAST_BATCH_SIZE_V1;
  const missingBatches = int(value.missingBatches, "BATCH_DOMAIN", 0);
  const authenticatedMatchingBatches = int(value.authenticatedMatchingBatches, "BATCH_DOMAIN", 0);
  const expectedKeyOrderDigest = hex64(value.expectedKeyOrderDigest, "BATCH_DOMAIN");
  const wfStatus = str(value.wfStatus, "BATCH_DOMAIN");
  const endExclusive = int(offsets.endExclusive, "BATCH_DOMAIN", 1);
  if (
    value.batchSize !== WF_FORECAST_BATCH_SIZE_V1 ||
    value.stage !== WF_FORECAST_BATCH_STAGE_V1 ||
    value.expectedBatches !== expectedBatches ||
    value.lastBatchAnchorCount !== lastBatchAnchorCount ||
    offsets.start !== 0 ||
    offsets.step !== WF_FORECAST_BATCH_SIZE_V1 ||
    endExclusive !== expectedAnchors ||
    authenticatedMatchingBatches + missingBatches !== expectedBatches
  )
    fail("BATCH_DOMAIN");
  return Object.freeze({
    authenticatedMatchingBatches,
    batchSize: WF_FORECAST_BATCH_SIZE_V1,
    expectedAnchors,
    expectedBatches,
    expectedKeyOrderDigest,
    lastBatchAnchorCount,
    missingBatches,
    offsets: Object.freeze({
      endExclusive,
      start: 0,
      step: WF_FORECAST_BATCH_SIZE_V1,
    }),
    stage: WF_FORECAST_BATCH_STAGE_V1,
    wfStatus,
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
  if (value.venue !== "htx" || value.market !== "spot") fail("SURFACE");
  if (value.symbol !== "BTCUSDT" && value.symbol !== "ETHUSDT") fail("SURFACE");
  const symbol = value.symbol === "ETHUSDT" ? ("ETHUSDT" as const) : ("BTCUSDT" as const);
  if (value.primaryHorizonMinutes !== 30 && value.primaryHorizonMinutes !== 60) fail("SURFACE");
  const primaryHorizonMinutes = value.primaryHorizonMinutes === 60 ? (60 as const) : (30 as const);
  if (value.surfaceKey !== `${symbol}:${primaryHorizonMinutes}`) fail("SURFACE");
  const surfaceKey =
    value.surfaceKey === "BTCUSDT:60"
      ? ("BTCUSDT:60" as const)
      : value.surfaceKey === "ETHUSDT:30"
        ? ("ETHUSDT:30" as const)
        : value.surfaceKey === "ETHUSDT:60"
          ? ("ETHUSDT:60" as const)
          : ("BTCUSDT:30" as const);
  if (surfaceKey !== `${symbol}:${primaryHorizonMinutes}`) fail("SURFACE");
  const kmBindingStatus = str(value.kmSelection.kmBindingStatus, "SURFACE");
  return Object.freeze({
    development: Object.freeze({
      datasetDigestHex: hex64(value.development.datasetDigestHex, "SURFACE"),
      rawSha256Hex: hex64(value.development.rawSha256Hex, "SURFACE"),
      sourceCount: int(value.development.sourceCount, "SURFACE", 1),
    }),
    evaluationPartition: Object.freeze({
      qualificationReceiptDigestHex: hex64(
        value.evaluationPartition.qualificationReceiptDigestHex,
        "SURFACE",
      ),
      receiptDigestHex: hex64(value.evaluationPartition.receiptDigestHex, "SURFACE"),
      walkForwardRawSha256Hex: hex64(value.evaluationPartition.walkForwardRawSha256Hex, "SURFACE"),
    }),
    expectedWfForecastBatchDomain: parseDomain(value.expectedWfForecastBatchDomain),
    kmSelection: Object.freeze({
      k: int(value.kmSelection.k, "SURFACE", 1),
      kmBindingStatus,
      m: int(value.kmSelection.m, "SURFACE", 1),
      surfaceAnchorSetDigestHex: hex64(value.kmSelection.surfaceAnchorSetDigestHex, "SURFACE"),
    }),
    market: "spot" as const,
    origin: Object.freeze({
      releaseSha: hex40(value.origin.releaseSha, "SURFACE"),
      runtime: originRuntime,
    }),
    primaryHorizonMinutes,
    selectedPackage: parseSelectedPackage(value.selectedPackage),
    surfaceKey,
    symbol,
    venue: "htx" as const,
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
  const s0 = hex40(mapping.S0, "MAPPING");
  const organizationId = str(mapping.O.organizationId, "MAPPING").trim();
  const releaseSha = hex40(mapping.O.releaseSha, "MAPPING");
  const runId = str(mapping.O.runId, "MAPPING").trim();
  const sealedAtUtc = str(mapping.sealedAtUtc, "MAPPING");
  const datasetContentDigest = hex64(mapping.dataset.datasetContentDigest, "MAPPING");
  const originRuntimeRequalificationDigest = hex64(
    mapping.dataset.originRuntimeRequalificationDigest,
    "MAPPING",
  );
  const qualificationReceiptDigestHex = hex64(
    mapping.dataset.qualificationReceiptDigestHex,
    "MAPPING",
  );
  const datasetRoot = str(mapping.dataset.root, "MAPPING");
  const missingForecastBatches = int(mapping.totals.missingForecastBatches, "MAPPING", 0);
  const missingForecastRows = int(mapping.totals.missingForecastRows, "MAPPING", 0);
  const originCompleteForecastBatches = int(
    mapping.totals.originCompleteForecastBatches,
    "MAPPING",
    0,
  );
  if (
    !organizationId ||
    !runId ||
    mapping.authorityGranted !== false ||
    mapping.generationAuthority !== "NOT_GRANTED" ||
    mapping.scientificAdmission !== "NOT_GRANTED" ||
    mapping.serverWrite !== "NOT_PERFORMED" ||
    mapping.schemaVersion !== G1_MAPPING_SCHEMA_V1
  )
    fail("MAPPING");
  denseArray(mapping.surfaces);
  denseArray(mapping.unselectedDuplicatePackageKeys);
  if (!mapping.surfaces.length) fail("SURFACES");
  if (
    !mapping.provenance ||
    typeof mapping.provenance !== "object" ||
    Array.isArray(mapping.provenance)
  )
    fail("MAPPING");
  const provenance: Record<string, unknown> = { ...mapping.provenance };
  const originRuntime = runtime(mapping.O.runtime);
  const surfaces = mapping.surfaces.map(parseSurface);
  const seen = new Set<string>();
  for (const surface of surfaces) {
    if (seen.has(surface.surfaceKey) || surface.origin.releaseSha !== releaseSha)
      fail("SURFACE_IDENTITY");
    seen.add(surface.surfaceKey);
  }
  return Object.freeze({
    authorityGranted: false,
    contentDigestHex: hex64(value.contentDigestHex, "ENVELOPE"),
    schemaVersion: G1_MAPPING_ENVELOPE_SCHEMA_V1,
    mapping: Object.freeze({
      O: Object.freeze({
        organizationId,
        releaseSha,
        runId,
        runtime: originRuntime,
      }),
      S0: s0,
      authorityGranted: false as const,
      dataset: Object.freeze({
        datasetContentDigest,
        originRuntimeRequalificationDigest,
        qualificationReceiptDigestHex,
        root: datasetRoot,
      }),
      generationAuthority: "NOT_GRANTED" as const,
      provenance: Object.freeze({ ...provenance }),
      schemaVersion: G1_MAPPING_SCHEMA_V1,
      scientificAdmission: "NOT_GRANTED" as const,
      sealedAtUtc,
      serverWrite: "NOT_PERFORMED" as const,
      surfaces: Object.freeze(surfaces),
      totals: Object.freeze({
        missingForecastBatches,
        missingForecastRows,
        originCompleteForecastBatches,
      }),
      unselectedDuplicatePackageKeys: Object.freeze([...mapping.unselectedDuplicatePackageKeys]),
    }),
  });
}
