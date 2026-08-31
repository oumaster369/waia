import { createReadStream } from "node:fs";
import { resolve, sep } from "node:path";
import { createInterface } from "node:readline";

import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { fhvBarsV2RecordToBar, parseFhvBarsV2Line } from "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import { assertFhvDatasetSealed, computeFhvFileRawSha256 } from "@/lib/trader/market-data/fhv-dataset-seal";
import { StreamingBarSetDigestHasher } from "@/lib/trader/market-data/fhv-streaming-bar-set-digest";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { HistoricalSealedMarketCycleV2 } from "@/lib/trader/historical-simulation-v2/modeled-execution-advance-v2";

export const HISTORICAL_DATASET_MEMBERSHIP_V2 = "waia.trader.historical_dataset_membership.v2" as const;

export type HistoricalDatasetMembershipV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_DATASET_MEMBERSHIP_V2;
  organizationId: string;
  cycleId: string;
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

function fail(code: string): never {
  throw new Error(`HISTORICAL_DATASET_MEMBERSHIP_REFUSED:${code}`);
}

export async function bindHistoricalCyclesToSealedDatasetV2(input: Readonly<{
  datasetRoot: string;
  organizationId: string;
  partition: "DEVELOPMENT" | "WALK_FORWARD";
  symbol: "BTCUSDT" | "ETHUSDT";
  cycles: readonly HistoricalSealedMarketCycleV2[];
}>): Promise<ReadonlyMap<string, HistoricalDatasetMembershipV2>> {
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

  const memberships = new Map<string, HistoricalDatasetMembershipV2>();
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
