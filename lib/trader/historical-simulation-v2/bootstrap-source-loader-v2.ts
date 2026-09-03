import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { assertPathDoesNotAccessBlindHoldoutPayload } from
  "@/lib/trader/market-data/fhv-blind-holdout-firewall";
import { fhvBarsV2RecordToBar, parseFhvBarsV2Line } from
  "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import {
  assertFhvPreHoldoutQualificationPass,
  readFhvPreHoldoutQualificationReceipt,
} from "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import { readFhvPreHoldoutRuntimeRequalification } from
  "@/lib/trader/market-data/fhv-pre-holdout-runtime-requalification";
import { fhvOfficialPartitionFileRelativePath } from
  "@/lib/trader/market-data/fhv-partition-boundaries";
import { assertHtxVolumeAuthorityQualified, readHtxVolumeQualificationReceipt,
  type HtxVolumeQualificationReceiptV1 } from
  "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { htxVolumeRawFromClosedBar } from "@/lib/trader/backtest/historical-execution-profile";
import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { HISTORICAL_DATASET_MEMBERSHIP_V2,
  type HistoricalPreHoldoutDatasetMembershipV2 } from "./dataset-membership-v2";
import { sealHistoricalMarketCycleV2, type HistoricalSealedMarketCycleV2 } from
  "./modeled-execution-advance-v2";

export type HistoricalSimulationBootstrapSourceCycleV2 = Readonly<{
  cycle: HistoricalSealedMarketCycleV2;
  membership: HistoricalPreHoldoutDatasetMembershipV2;
}>;

export type HistoricalSimulationBootstrapSourceSnapshotV2 = Readonly<{
  sources: readonly HistoricalSimulationBootstrapSourceCycleV2[];
  qualificationReceiptDigestHex: string;
  partitionRawSha256Hex: string;
  partitionSemanticDigestHex: string;
}>;

function partitionPath(
  partition: "DEVELOPMENT" | "WALK_FORWARD",
): "development" | "walk-forward" {
  return partition === "DEVELOPMENT" ? "development" : "walk-forward";
}

function cycleId(runId: string, partition: string, symbol: string, recordIndex: number): string {
  return `${runId}:${partition}:${symbol}:${recordIndex}`;
}

export async function loadHistoricalSimulationBootstrapSourceCyclesV2(input: Readonly<{
  datasetRoot: string; qualificationReceiptPath: string; runtimeRequalificationReceiptPath: string;
  htxVolumeQualificationReceiptPath: string; releaseSha: string; organizationId: string; runId: string;
  partition: "DEVELOPMENT" | "WALK_FORWARD"; symbol: "BTCUSDT" | "ETHUSDT";
  initialRecordIndex: number; cycleCount: number;
}>): Promise<readonly HistoricalSimulationBootstrapSourceCycleV2[]> {
  const snapshot = await loadHistoricalSimulationBootstrapSourceSnapshotV2(input);
  return snapshot.sources;
}

/**
 * Reads, hashes, seals and binds the selected cycles in one complete byte-stream pass.
 * The returned memberships therefore cannot describe bars from a different file snapshot.
 */
export async function loadHistoricalSimulationBootstrapSourceSnapshotV2(input: Readonly<{
  datasetRoot: string; qualificationReceiptPath: string; runtimeRequalificationReceiptPath: string;
  htxVolumeQualificationReceiptPath: string; releaseSha: string; organizationId: string; runId: string;
  partition: "DEVELOPMENT" | "WALK_FORWARD"; symbol: "BTCUSDT" | "ETHUSDT";
  initialRecordIndex: number; cycleCount: number;
}>): Promise<HistoricalSimulationBootstrapSourceSnapshotV2> {
  if (!Number.isSafeInteger(input.initialRecordIndex) || input.initialRecordIndex < 0 ||
      !Number.isSafeInteger(input.cycleCount) || input.cycleCount < 1 || input.cycleCount > 10_000) {
    throw new Error("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:CYCLE_RANGE");
  }
  const qualification = readFhvPreHoldoutQualificationReceipt(input.qualificationReceiptPath);
  assertFhvPreHoldoutQualificationPass(qualification);
  const releaseSha = input.releaseSha.trim().toLowerCase();
  if (
    qualification.organizationId !== input.organizationId ||
    qualification.holdout.status !== "PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED"
  ) {
    throw new Error("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:QUALIFICATION_SCOPE");
  }
  if (qualification.releaseSha !== releaseSha) {
    const runtime = readFhvPreHoldoutRuntimeRequalification(
      input.runtimeRequalificationReceiptPath,
    );
    if (
      runtime.sourceQualificationReceiptDigest !== qualification.qualificationReceiptDigest ||
      runtime.sourceReleaseSha !== qualification.releaseSha ||
      runtime.targetReleaseSha !== releaseSha ||
      runtime.datasetContentDigest !== qualification.developmentWalkForwardContentDigest ||
      runtime.organizationId !== qualification.organizationId
    ) {
      throw new Error("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:RUNTIME_SCOPE");
    }
  }
  const receiptPartition = input.partition === "DEVELOPMENT" ? "development" : "walk-forward";
  const partitionEvidence = qualification.partitions.find((entry) =>
    entry.partition === receiptPartition && entry.symbol === input.symbol);
  if (
    !partitionEvidence ||
    input.initialRecordIndex + input.cycleCount > partitionEvidence.barCount
  ) {
    throw new Error("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:PARTITION_SCOPE");
  }
  const receipt = readHtxVolumeQualificationReceipt(JSON.parse(
    readFileSync(input.htxVolumeQualificationReceiptPath, "utf8"),
  ) as HtxVolumeQualificationReceiptV1);
  assertHtxVolumeAuthorityQualified(receipt);
  if (receipt.symbol.replace("/", "") !== input.symbol) {
    throw new Error("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:VOLUME_AUTHORITY_SYMBOL");
  }
  const root = resolve(input.datasetRoot);
  const filePath = resolve(root, fhvOfficialPartitionFileRelativePath({
    partition: partitionPath(input.partition),
    symbol: input.symbol,
  }));
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    throw new Error("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:FILE_PATH_ESCAPE");
  }
  assertPathDoesNotAccessBlindHoldoutPayload(filePath);
  const rawHasher = createHash("sha256");
  const source = createReadStream(filePath);
  async function* authenticatedBytes(): AsyncGenerator<Buffer> {
    for await (const chunk of source) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      rawHasher.update(bytes);
      yield bytes;
    }
  }
  const cycles: HistoricalSealedMarketCycleV2[] = [];
  let index = 0;
  const lines = createInterface({ input: Readable.from(authenticatedBytes()), crlfDelay: Infinity });
  for await (const line of lines) {
    const bar = fhvBarsV2RecordToBar(parseFhvBarsV2Line(line, index + 1));
    if (bar.symbol.replace("/", "") !== input.symbol) {
      throw new Error("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:SOURCE_SYMBOL");
    }
    if (
      index >= input.initialRecordIndex &&
      index < input.initialRecordIndex + input.cycleCount
    ) {
      cycles.push(sealHistoricalMarketCycleV2({
        cycleId: cycleId(input.runId, input.partition, input.symbol, index), barIndex: index,
        closedBar: bar, htxVolumeAuthorityReceipt: receipt,
        htxVolumeRaw: htxVolumeRawFromClosedBar(bar),
      }));
    }
    index += 1;
  }
  const rawSha256Hex = rawHasher.digest("hex");
  if (
    cycles.length !== input.cycleCount ||
    index !== partitionEvidence.barCount ||
    rawSha256Hex !== partitionEvidence.rawSha256
  ) {
    throw new Error("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:SOURCE_RANGE_MISSING");
  }
  const sources = cycles.map((cycle) => {
    const body = {
      schemaVersion: HISTORICAL_DATASET_MEMBERSHIP_V2,
      organizationId: input.organizationId,
      cycleId: cycle.cycleId,
      datasetAuthorityClass: "PRE_HOLDOUT_QUALIFICATION_V1" as const,
      datasetAuthorityDigestHex: qualification.qualificationReceiptDigest,
      qualificationReceiptDigestHex: qualification.qualificationReceiptDigest,
      partitionDigestHex: partitionEvidence.semanticContentDigest,
      partitionRawSha256Hex: rawSha256Hex,
      partition: input.partition,
      symbol: input.symbol,
      recordIndex: cycle.barIndex,
      barContentDigestHex: computeBarContentDigest(cycle.closedBar),
      sealedCycleContentDigestHex: cycle.contentDigestHex,
    };
    const membership = Object.freeze({
      ...body,
      contentDigestHex: computeSemanticSha256Hex(body),
    });
    return Object.freeze({ cycle, membership });
  });
  return Object.freeze({
    sources: Object.freeze(sources),
    qualificationReceiptDigestHex: qualification.qualificationReceiptDigest,
    partitionRawSha256Hex: rawSha256Hex,
    partitionSemanticDigestHex: partitionEvidence.semanticContentDigest,
  });
}
