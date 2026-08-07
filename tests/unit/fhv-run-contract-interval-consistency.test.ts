import { describe, expect, it } from "vitest";

import { FHV_DATASET_PARTITIONS_V1 } from "@/lib/trader/market-data/dataset/fhv-dataset-manifest";
import { assertFhvRunContractIntervalsMatchPartitions } from "@/lib/trader/observability/fhv-full-historical-launch";
import { HTR_FHV_RUN_CONTRACT_V0 } from "@/lib/trader/readiness/htr-fhv-run-contract-v0";

describe("DEE-436 FHV run contract interval half-open consistency", () => {
  it("matches FHV_DATASET_PARTITIONS_V1 for all partition fields", () => {
    expect(HTR_FHV_RUN_CONTRACT_V0.fullPeriod).toEqual({
      startUtc: "2020-01-01T00:00:00.000Z",
      endUtc: "2026-01-01T00:00:00.000Z",
    });
    expect(HTR_FHV_RUN_CONTRACT_V0.developmentCalibration).toEqual(
      FHV_DATASET_PARTITIONS_V1.development,
    );
    expect(HTR_FHV_RUN_CONTRACT_V0.walkForward).toEqual(FHV_DATASET_PARTITIONS_V1.walkForward);
    expect(HTR_FHV_RUN_CONTRACT_V0.blindHoldout).toEqual(FHV_DATASET_PARTITIONS_V1.blindHoldout);
    expect(HTR_FHV_RUN_CONTRACT_V0.partitions).toEqual(FHV_DATASET_PARTITIONS_V1);
  });

  it("assertFhvRunContractIntervalsMatchPartitions passes on pinned contract", () => {
    expect(() => assertFhvRunContractIntervalsMatchPartitions()).not.toThrow();
  });

  it("does not use legacy 23:59 exclusive-end timestamps", () => {
    const contractJson = JSON.stringify(HTR_FHV_RUN_CONTRACT_V0);
    expect(contractJson).not.toContain("23:59:00.000Z");
    expect(contractJson).toContain("2026-01-01T00:00:00.000Z");
  });
});
