import { createReadStream } from "node:fs";
import { resolve, sep } from "node:path";
import { createInterface } from "node:readline";

import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { fhvBarsV2RecordToBar, parseFhvBarsV2Line } from "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import { assertFhvDatasetSealed, computeFhvFileRawSha256 } from "@/lib/trader/market-data/fhv-dataset-seal";
import {
  assertFhvPreHoldoutFilesMatchReceipt,
  assertFhvPreHoldoutQualificationPass,
  readFhvPreHoldoutQualificationReceipt,
} from "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import { readFhvPreHoldoutRuntimeRequalification } from
  "@/lib/trader/market-data/fhv-pre-holdout-runtime-requalification";
import { fhvOfficialPartitionFileRelativePath } from "@/lib/trader/market-data/fhv-partition-boundaries";
import { StreamingBarSetDigestHasher } from "@/lib/trader/market-data/fhv-streaming-bar-set-digest";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { HistoricalSealedMarketCycleV2 } from "@/lib/trader/historical-simulation-v2/modeled-execution-advance-v2";

export const HISTORICAL_DATASET_MEMBERSHIP_V2 = "waia.trader.historical_dataset_membership.v2" as const;

export type HistoricalSealedDatasetMembershipV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_DATASET_MEMBERSHIP_V2;
  organizationId: string;
  cycleId: string;
  datasetAuthorityClass?: "FULL_SEALED_DATASET_V2";
  datasetAuthorityDigestHex?: string;
  manifestSemanticDigestHex: string;
  sealReceiptDigestHex: string;
  partitionDigestHex: string;
  partitionRawSha256Hex: string;
  partition: "DEVELOPMENT" | "WALK_FORWARD";
  symbol: "BTCUSDT" | "ETHUSDT";
  recordIndex: number;
  barContentDigestHex: string;
  sealedCycleContentDigestHex: string;
  contentDigestHex: string;
}>;

export type HistoricalPreHoldoutDatasetMembershipV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_DATASET_MEMBERSHIP_V2;
  organizationId: string;
  cycleId: string;
  datasetAuthorityClass: "PRE_HOLDOUT_QUALIFICATION_V1";
  datasetAuthorityDigestHex: string;
  qualificationReceiptDigestHex: string;
  partitionDigestHex: string;
  partitionRawSha256Hex: string;
  partition: "DEVELOPMENT" | "WALK_FORWARD";
  symbol: "BTCUSDT" | "ETHUSDT";
  recordIndex: number;
  barContentDigestHex: string;
  sealedCycleContentDigestHex: string;
  contentDigestHex: string;
}>;

export type HistoricalDatasetMembershipV2 =
  | HistoricalSealedDatasetMembershipV2
  | HistoricalPreHoldoutDatasetMembershipV2;

function fail(code: string): never {
  throw new Error(`HISTORICAL_DATASET_MEMBERSHIP_REFUSED:${code}`);
}

export async function bindHistoricalCyclesToSealedDatasetV2(input: Readonly<{
  datasetRoot: string;
  organizationId: string;
  partition: "DEVELOPMENT" | "WALK_FORWARD";
  symbol: "BTCUSDT" | "ETHUSDT";
  cycles: readonly HistoricalSealedMarketCycleV2[];
}>): Promise<ReadonlyMap<string, HistoricalSealedDatasetMembershipV2>> {
  const sealed = assertFhvDatasetSealed(input.datasetRoot);
  if (sealed.manifest.organizationId !== input.organizationId) fail("ORGANIZATION_SCOPE");
  const manifestPartition = input.partition === "DEVELOPMENT" ? "development" : "walk-forward";
  const entry = sealed.manifest.partitions.find((candidate) =>
    candidate.partition === manifestPartition && candidate.symbol === input.symbol);
  if (!entry) fail("PARTITION_NOT_IN_MANIFEST");
  const root = resolve(input.datasetRoot);
  const filePath = resolve(root, entry.filePath);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) fail("FILE_PATH_ESCAPE");
  if (computeFhvFileRawSha256(filePath) !== entry.rawSha256) fail("RAW_DIGEST_MISMATCH");

  const memberships = new Map<string, HistoricalSealedDatasetMembershipV2>();
  const semantic = new StreamingBarSetDigestHasher();
  let recordIndex = 0;
  const lines = createInterface({ input: createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    const record = parseFhvBarsV2Line(line, recordIndex + 1);
    const bar = fhvBarsV2RecordToBar(record);
    const cycle = input.cycles[recordIndex];
    if (!cycle || cycle.barIndex !== recordIndex) fail("NON_CONTIGUOUS_OR_MISSING_CYCLE");
    const barDigest = computeBarContentDigest(bar);
    semantic.appendBarDigest(barDigest);
    if (computeBarContentDigest(cycle.closedBar) !== barDigest) fail("BAR_MEMBERSHIP_MISMATCH");
    if (memberships.has(cycle.cycleId)) fail("DUPLICATE_CYCLE_ID");
    const body = {
      schemaVersion: HISTORICAL_DATASET_MEMBERSHIP_V2,
      organizationId: input.organizationId,
      cycleId: cycle.cycleId,
      datasetAuthorityClass: "FULL_SEALED_DATASET_V2" as const,
      datasetAuthorityDigestHex: sealed.sealReceipt.sealReceiptDigest,
      manifestSemanticDigestHex: sealed.manifest.manifestSemanticDigest,
      sealReceiptDigestHex: sealed.sealReceipt.sealReceiptDigest,
      partitionDigestHex: entry.partitionDigest,
      partitionRawSha256Hex: entry.rawSha256,
      partition: input.partition,
      symbol: input.symbol,
      recordIndex,
      barContentDigestHex: barDigest,
      sealedCycleContentDigestHex: cycle.contentDigestHex,
    };
    memberships.set(cycle.cycleId, Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) }));
    recordIndex += 1;
  }
  if (recordIndex !== entry.actualBarCount || input.cycles.length !== recordIndex) fail("BAR_COUNT_MISMATCH");
  if (semantic.finalize() !== entry.semanticDigest) fail("SEMANTIC_DIGEST_MISMATCH");
  return memberships;
}

export async function bindHistoricalCyclesToPreHoldoutDatasetV2(input: Readonly<{
  datasetRoot: string;
  qualificationReceiptPath: string;
  runtimeRequalificationReceiptPath?: string;
  releaseSha: string;
  organizationId: string;
  partition: "DEVELOPMENT" | "WALK_FORWARD";
  symbol: "BTCUSDT" | "ETHUSDT";
  cycles: readonly HistoricalSealedMarketCycleV2[];
}>): Promise<ReadonlyMap<string, HistoricalPreHoldoutDatasetMembershipV2>> {
  const receipt = readFhvPreHoldoutQualificationReceipt(input.qualificationReceiptPath);
  assertFhvPreHoldoutQualificationPass(receipt);
  assertFhvPreHoldoutFilesMatchReceipt({ datasetRoot: input.datasetRoot, receipt });
  if (receipt.organizationId !== input.organizationId) fail("ORGANIZATION_SCOPE");
  const releaseSha = input.releaseSha.trim().toLowerCase();
  if (receipt.releaseSha !== releaseSha) {
    if (!input.runtimeRequalificationReceiptPath) fail("RELEASE_SCOPE");
    const runtime = readFhvPreHoldoutRuntimeRequalification(input.runtimeRequalificationReceiptPath);
    if (runtime.sourceQualificationReceiptDigest !== receipt.qualificationReceiptDigest ||
        runtime.sourceReleaseSha !== receipt.releaseSha || runtime.targetReleaseSha !== releaseSha ||
        runtime.datasetContentDigest !== receipt.developmentWalkForwardContentDigest ||
        runtime.organizationId !== receipt.organizationId) {
      fail("RUNTIME_REQUALIFICATION_SCOPE");
    }
  }
  if (receipt.holdout.status !== "PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED") {
    fail("HOLDOUT_STATUS");
  }
  const manifestPartition = input.partition === "DEVELOPMENT" ? "development" : "walk-forward";
  const entry = receipt.partitions.find((candidate) =>
    candidate.partition === manifestPartition && candidate.symbol === input.symbol);
  if (!entry) fail("PARTITION_NOT_IN_QUALIFICATION");
  const root = resolve(input.datasetRoot);
  const filePath = resolve(root, fhvOfficialPartitionFileRelativePath({
    partition: manifestPartition,
    symbol: input.symbol,
  }));
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) fail("FILE_PATH_ESCAPE");
  if (computeFhvFileRawSha256(filePath) !== entry.rawSha256) fail("RAW_DIGEST_MISMATCH");

  if (input.cycles.length === 0) fail("EMPTY_CYCLE_SELECTION");
  const firstRecordIndex = input.cycles[0]!.barIndex;
  for (let offset = 0; offset < input.cycles.length; offset += 1) {
    if (input.cycles[offset]!.barIndex !== firstRecordIndex + offset) {
      fail("NON_CONTIGUOUS_OR_MISSING_CYCLE");
    }
  }
  if (firstRecordIndex < 0 || firstRecordIndex + input.cycles.length > entry.barCount) {
    fail("CYCLE_SELECTION_OUT_OF_RANGE");
  }

  const memberships = new Map<string, HistoricalPreHoldoutDatasetMembershipV2>();
  let recordIndex = 0;
  const lines = createInterface({ input: createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (recordIndex < firstRecordIndex) {
      recordIndex += 1;
      continue;
    }
    const cycleOffset = recordIndex - firstRecordIndex;
    if (cycleOffset >= input.cycles.length) break;
    const record = parseFhvBarsV2Line(line, recordIndex + 1);
    const bar = fhvBarsV2RecordToBar(record);
    const cycle = input.cycles[cycleOffset];
    if (!cycle || cycle.barIndex !== recordIndex) fail("NON_CONTIGUOUS_OR_MISSING_CYCLE");
    const barDigest = computeBarContentDigest(bar);
    if (computeBarContentDigest(cycle.closedBar) !== barDigest) fail("BAR_MEMBERSHIP_MISMATCH");
    if (memberships.has(cycle.cycleId)) fail("DUPLICATE_CYCLE_ID");
    const body = {
      schemaVersion: HISTORICAL_DATASET_MEMBERSHIP_V2,
      organizationId: input.organizationId,
      cycleId: cycle.cycleId,
      datasetAuthorityClass: "PRE_HOLDOUT_QUALIFICATION_V1" as const,
      datasetAuthorityDigestHex: receipt.qualificationReceiptDigest,
      qualificationReceiptDigestHex: receipt.qualificationReceiptDigest,
      partitionDigestHex: entry.semanticContentDigest,
      partitionRawSha256Hex: entry.rawSha256,
      partition: input.partition,
      symbol: input.symbol,
      recordIndex,
      barContentDigestHex: barDigest,
      sealedCycleContentDigestHex: cycle.contentDigestHex,
    };
    memberships.set(cycle.cycleId, Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) }));
    recordIndex += 1;
  }
  if (memberships.size !== input.cycles.length) fail("BAR_COUNT_MISMATCH");
  return memberships;
}
