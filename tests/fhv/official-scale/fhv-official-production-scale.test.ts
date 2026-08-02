import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import {
  assertFhvDatasetSealed,
  validateFhvV2DatasetReadOnly,
} from "@/lib/trader/market-data/fhv-dataset-seal";
import {
  FhvOfficialDatasetReader,
  type CheckpointableBarReplaySource,
} from "@/lib/trader/market-data/fhv-official-dataset-reader";
import type { FhvOfficialDatasetCursorV2 } from "@/lib/trader/market-data/fhv-official-dataset-cursor";
import { FHV_OFFICIAL_TOTAL_BARS } from "@/lib/trader/market-data/fhv-official-scale-corpus";
import {
  buildFhvDatasetQualificationReceipt,
  FHV_DATASET_QUALIFICATION_RECEIPT_FILENAME,
} from "@/lib/trader/observability/fhv-dataset-qualification";
import { qualifyFhvOfficialDataset } from "@/lib/trader/observability/fhv-dataset-qualification";
import { revalidateFhvDatasetAtLaunch } from "@/lib/trader/observability/fhv-dataset-launch-guard";
import {
  buildFhvOfficialV2ScaleDataset,
  FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
  FHV_TEST_ORG_ID,
  FHV_TEST_OPERATOR_ID,
  FHV_TEST_RELEASE_TAG,
} from "@/tests/helpers/fhv-official-path-test-fixtures";

const MEMORY_CEILING_BYTES = 512 * 1024 * 1024;
const CRASH_RESUME_TAIL_CYCLES = 512;

function createProductionReader(datasetRoot: string): CheckpointableBarReplaySource {
  return new FhvOfficialDatasetReader({
    datasetRoot,
    accessPurpose: "INTEGRITY_QUALIFICATION",
    includeHoldoutPartitions: true,
    cycleIdPrefix: "fhv-production-scale",
  });
}

function exhaustReaderCycles(reader: CheckpointableBarReplaySource): {
  cycleCount: number;
  globalEventSequence: number;
} {
  while (true) {
    const result = reader.next();
    if (result.done) {
      break;
    }
  }
  const cursor = reader.captureCursor();
  return {
    cycleCount: cursor.cycleIndex,
    globalEventSequence: cursor.globalEventSequence,
  };
}

function resolveDevelopmentMidpointEvent(datasetRoot: string): number {
  const sealed = assertFhvDatasetSealed(datasetRoot);
  const developmentBars = sealed.manifest.partitions
    .filter((entry) => entry.partition === "development")
    .reduce((sum, entry) => sum + entry.actualBarCount, 0);
  return Math.floor(developmentBars / 2);
}

function advanceReaderUntilEventSequence(
  reader: CheckpointableBarReplaySource,
  targetSequence: number,
): FhvOfficialDatasetCursorV2 {
  while (reader.captureCursor().globalEventSequence < targetSequence) {
    const result = reader.next();
    if (result.done) {
      throw new Error(
        `[fhv-production-scale] reader exhausted before target sequence ${targetSequence}`,
      );
    }
  }
  return reader.captureCursor();
}

function advanceReaderTailCycles(
  reader: CheckpointableBarReplaySource,
  cycles: number,
): FhvOfficialDatasetCursorV2 {
  for (let index = 0; index < cycles; index += 1) {
    const result = reader.next();
    if (result.done) {
      throw new Error("[fhv-production-scale] reader exhausted during tail segment");
    }
  }
  return reader.captureCursor();
}

function cursorSemanticDigestPrefix(cursor: FhvOfficialDatasetCursorV2): string {
  return computeStableJsonDigest(cursor).slice(0, 16);
}

describe("fhv official v2 production path scale", () => {
  let datasetRoot: string;

  beforeAll(() => {
    datasetRoot = mkdtempSync(join(tmpdir(), "fhv-official-production-scale-"));
    buildFhvOfficialV2ScaleDataset(datasetRoot);
  }, 600_000);

  afterAll(() => {
    if (datasetRoot) {
      rmSync(datasetRoot, { recursive: true, force: true });
    }
  });

  it("FHV_OFFICIAL_MULTI_YEAR_PRODUCTION_PATH_SCALE_PASS", () => {
    const validated = validateFhvV2DatasetReadOnly(datasetRoot);
    expect(validated.classification).toBe("FHV_V2_DATASET_VALIDATION_PASS");

    const validationHeapBefore = process.memoryUsage().heapUsed;
    const qualificationBody = qualifyFhvOfficialDataset({
      datasetRoot,
      manifestPath: join(datasetRoot, "fhv-dataset-manifest.v2.json"),
      qualificationMode: "OFFICIAL_MULTI_YEAR",
      releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
      releaseTag: FHV_TEST_RELEASE_TAG,
      organizationId: FHV_TEST_ORG_ID,
      operatorId: FHV_TEST_OPERATOR_ID,
    });
    const validationHeapAfter = process.memoryUsage().heapUsed;
    expect(validationHeapAfter - validationHeapBefore).toBeLessThan(MEMORY_CEILING_BYTES);
    expect(qualificationBody.classification).toBe("DATASET_QUALIFICATION=PASS");

    const sealed = assertFhvDatasetSealed(datasetRoot);
    expect(sealed.manifest.partitions.reduce((sum, entry) => sum + entry.actualBarCount, 0)).toBe(
      FHV_OFFICIAL_TOTAL_BARS,
    );

    const receiptDir = mkdtempSync(join(tmpdir(), "fhv-production-qualify-receipt-"));
    try {
      const receipt = buildFhvDatasetQualificationReceipt({
        ...qualificationBody,
        qualifiedAtUtc: "2026-01-01T00:00:00.000Z",
      });
      const qualificationReceiptPath = join(receiptDir, FHV_DATASET_QUALIFICATION_RECEIPT_FILENAME);
      writeFileSync(qualificationReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

      const relaunchGuard = revalidateFhvDatasetAtLaunch({
        datasetQualificationReceiptPath: qualificationReceiptPath,
        datasetRoot,
        manifestPath: join(datasetRoot, "fhv-dataset-manifest.v2.json"),
      });
      expect(relaunchGuard.datasetContentDigest).toBe(sealed.manifest.datasetContentDigest);
      expect(relaunchGuard.manifestSemanticDigest).toBe(sealed.manifest.manifestSemanticDigest);
    } finally {
      rmSync(receiptDir, { recursive: true, force: true });
    }

    const reader = createProductionReader(datasetRoot);
    const { cycleCount, globalEventSequence } = exhaustReaderCycles(reader);
    reader.close();

    expect(globalEventSequence).toBe(FHV_OFFICIAL_TOTAL_BARS);
    expect(cycleCount).toBeGreaterThan(FHV_OFFICIAL_TOTAL_BARS - EXPAND_MIN_BARS * 4);
    expect(cycleCount).toBeLessThanOrEqual(FHV_OFFICIAL_TOTAL_BARS);

    const warmupEvents = globalEventSequence - cycleCount;
    expect(warmupEvents).toBeGreaterThan(0);
    expect(warmupEvents).toBeLessThan(EXPAND_MIN_BARS * 4);
    expect(cycleCount).toBe(globalEventSequence - warmupEvents);
  }, 600_000);

  it("FHV_OFFICIAL_MULTI_YEAR_CRASH_RESUME_SEMANTIC_PARITY_PASS at development midpoint", () => {
    const midpointSequence = resolveDevelopmentMidpointEvent(datasetRoot);
    const reader = createProductionReader(datasetRoot);

    advanceReaderUntilEventSequence(reader, midpointSequence);
    const checkpoint = reader.captureCursor();
    const uninterruptedCursor = advanceReaderTailCycles(reader, CRASH_RESUME_TAIL_CYCLES);
    const uninterruptedPrefix = cursorSemanticDigestPrefix(uninterruptedCursor);

    reader.restoreCursor(checkpoint);
    const resumedCursor = advanceReaderTailCycles(reader, CRASH_RESUME_TAIL_CYCLES);
    const resumedPrefix = cursorSemanticDigestPrefix(resumedCursor);
    reader.close();

    expect(resumedPrefix).toBe(uninterruptedPrefix);
    expect(resumedCursor.globalEventSequence).toBe(uninterruptedCursor.globalEventSequence);
    expect(resumedCursor.cycleIndex).toBe(uninterruptedCursor.cycleIndex);
  }, 600_000);
});
