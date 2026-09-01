import { createReadStream, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { fhvBarsV2RecordToBar, parseFhvBarsV2Line } from
  "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import { assertHtxVolumeAuthorityQualified, readHtxVolumeQualificationReceipt,
  type HtxVolumeQualificationReceiptV1 } from
  "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { htxVolumeRawFromClosedBar } from "@/lib/trader/backtest/historical-execution-profile";
import { bindHistoricalCyclesToPreHoldoutDatasetV2,
  type HistoricalPreHoldoutDatasetMembershipV2 } from "./dataset-membership-v2";
import { sealHistoricalMarketCycleV2, type HistoricalSealedMarketCycleV2 } from
  "./modeled-execution-advance-v2";

export type HistoricalSimulationBootstrapSourceCycleV2 = Readonly<{
  cycle: HistoricalSealedMarketCycleV2;
  membership: HistoricalPreHoldoutDatasetMembershipV2;
}>;

function partitionPath(partition: "DEVELOPMENT" | "WALK_FORWARD"): string {
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
  if (!Number.isSafeInteger(input.initialRecordIndex) || input.initialRecordIndex < 0 ||
      !Number.isSafeInteger(input.cycleCount) || input.cycleCount < 1 || input.cycleCount > 10_000) {
    throw new Error("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:CYCLE_RANGE");
  }
  const receipt = readHtxVolumeQualificationReceipt(JSON.parse(
    readFileSync(input.htxVolumeQualificationReceiptPath, "utf8"),
  ) as HtxVolumeQualificationReceiptV1);
  assertHtxVolumeAuthorityQualified(receipt);
  if (receipt.symbol.replace("/", "") !== input.symbol) {
    throw new Error("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:VOLUME_AUTHORITY_SYMBOL");
  }
  const filePath = join(input.datasetRoot, "partitions", partitionPath(input.partition),
    input.symbol, "bars.v2.ndjson");
  const cycles: HistoricalSealedMarketCycleV2[] = [];
  let index = 0;
  const lines = createInterface({ input: createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (index < input.initialRecordIndex) { index += 1; continue; }
    if (cycles.length === input.cycleCount) break;
    const bar = fhvBarsV2RecordToBar(parseFhvBarsV2Line(line, index + 1));
    cycles.push(sealHistoricalMarketCycleV2({
      cycleId: cycleId(input.runId, input.partition, input.symbol, index), barIndex: index,
      closedBar: bar, htxVolumeAuthorityReceipt: receipt, htxVolumeRaw: htxVolumeRawFromClosedBar(bar),
    }));
    index += 1;
  }
  if (cycles.length !== input.cycleCount) {
    throw new Error("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:SOURCE_RANGE_MISSING");
  }
  const memberships = await bindHistoricalCyclesToPreHoldoutDatasetV2({
    datasetRoot: input.datasetRoot, qualificationReceiptPath: input.qualificationReceiptPath,
    runtimeRequalificationReceiptPath: input.runtimeRequalificationReceiptPath,
    releaseSha: input.releaseSha, organizationId: input.organizationId, partition: input.partition,
    symbol: input.symbol, cycles,
  });
  return Object.freeze(cycles.map((cycle) => Object.freeze({ cycle,
    membership: memberships.get(cycle.cycleId) ?? (() => {
      throw new Error("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:MEMBERSHIP_MISSING");
    })(),
  })));
}
