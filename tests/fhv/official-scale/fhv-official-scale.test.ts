import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FHV_OFFICIAL_PARTITION_NAMES,
  FHV_OFFICIAL_SYMBOLS,
} from "@/lib/trader/market-data/fhv-partition-boundaries";
import {
  assertFhvDatasetSealed,
  validateFhvV2DatasetReadOnly,
} from "@/lib/trader/market-data/fhv-dataset-seal";
import { FhvOfficialDatasetReader } from "@/lib/trader/market-data/fhv-official-dataset-reader";
import { FHV_OFFICIAL_TOTAL_BARS } from "@/lib/trader/market-data/fhv-official-scale-corpus";
import { execFileSync } from "node:child_process";

const RELEASE_SHA = "528a5a5529f42eb9998f783a5827e23ea3a7f557";
const ORG_ID = "00000000-0000-4000-8000-000000000436";
const OPERATOR_ID = "official-scale-test";
const ACQUISITION_RUN_ID = "scale-acq-001";
const SEAL_RUN_ID = "scale-seal-001";

function runAcquire(input: {
  datasetRoot: string;
  partition: (typeof FHV_OFFICIAL_PARTITION_NAMES)[number];
  symbol: (typeof FHV_OFFICIAL_SYMBOLS)[number];
}): void {
  execFileSync(
    "pnpm",
    [
      "trader:fhv:acquire-htx-v2",
      "--",
      "--partition",
      input.partition,
      "--symbol",
      input.symbol,
      "--dataset-root",
      input.datasetRoot,
      "--scale-corpus",
      "--release-sha",
      RELEASE_SHA,
      "--organization-id",
      ORG_ID,
      "--operator-id",
      OPERATOR_ID,
      "--acquisition-run-id",
      ACQUISITION_RUN_ID,
    ],
    { stdio: "pipe", cwd: process.cwd() },
  );
}

function runSeal(datasetRoot: string): void {
  execFileSync(
    "pnpm",
    [
      "trader:fhv:seal-v2-dataset",
      "--",
      "--dataset-root",
      datasetRoot,
      "--acquisition-receipt-dir",
      join(datasetRoot, "control", "acquisition"),
      "--seal-run-id",
      SEAL_RUN_ID,
      "--release-sha",
      RELEASE_SHA,
      "--organization-id",
      ORG_ID,
      "--operator-id",
      OPERATOR_ID,
    ],
    { stdio: "pipe", cwd: process.cwd() },
  );
}

describe("fhv official v2 scale-fixture infrastructure smoke", () => {
  it("FHV_V2_SCALE_FIXTURE_ACQUIRE_SEAL_VALIDATE_READER_SMOKE_PASS", () => {
    const datasetRoot = mkdtempSync(join(tmpdir(), "fhv-official-scale-"));
    try {
      for (const partition of FHV_OFFICIAL_PARTITION_NAMES) {
        for (const symbol of FHV_OFFICIAL_SYMBOLS) {
          runAcquire({ datasetRoot, partition, symbol });
        }
      }
      runSeal(datasetRoot);
      const validated = validateFhvV2DatasetReadOnly(datasetRoot);
      expect(validated.classification).toBe("FHV_V2_DATASET_VALIDATION_PASS");

      const sealed = assertFhvDatasetSealed(datasetRoot);
      expect(sealed.manifest.datasetContentDigest).toBeTruthy();

      const reader = new FhvOfficialDatasetReader({
        datasetRoot,
        accessPurpose: "CONTROL_REPLAY_STRATEGY",
        includeHoldoutPartitions: false,
        cycleIdPrefix: "fhv-scale-test",
      });

      const sampleCycles = 256;
      let cycleCount = 0;
      for (let index = 0; index < sampleCycles; index += 1) {
        const result = reader.next();
        if (result.done) {
          break;
        }
        cycleCount += 1;
      }
      reader.close();

      const totalBars = sealed.manifest.partitions.reduce(
        (sum, entry) => sum + entry.actualBarCount,
        0,
      );
      const expectedNonHoldoutBars = sealed.manifest.partitions
        .filter((entry) => entry.partition !== "blind-holdout")
        .reduce((sum, entry) => sum + entry.actualBarCount, 0);

      expect(totalBars).toBe(FHV_OFFICIAL_TOTAL_BARS);
      expect(expectedNonHoldoutBars).toBeGreaterThan(FHV_OFFICIAL_TOTAL_BARS / 2);
      expect(cycleCount).toBe(sampleCycles);
    } finally {
      rmSync(datasetRoot, { recursive: true, force: true });
    }
  }, 600_000);
});
