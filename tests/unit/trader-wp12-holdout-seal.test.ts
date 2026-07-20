/**
 * HTR-WP12 — blind holdout seal metadata without 2025 price reads.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildFhvDatasetManifest,
  FHV_DATASET_PARTITIONS_V1,
} from "@/lib/trader/market-data/dataset/fhv-dataset-manifest";
import { assertIngestBarsIntegrity } from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import {
  makeSyntheticBars,
  SYNTHETIC_SOURCE_PROVENANCE,
} from "@/tests/unit/helpers/wp11-wp12-fixture";

describe("HTR-WP12 holdout seal", () => {
  it("FHV partitions declare blind holdout as sealed metadata only", () => {
    expect(FHV_DATASET_PARTITIONS_V1.blindHoldout).toEqual({
      startUtc: "2025-01-01T00:00:00.000Z",
      endUtc: "2026-01-01T00:00:00.000Z",
      status: "SEALED_NOT_ACCESSED",
    });
  });

  it("buildFhvDatasetManifest never reads holdout price paths", () => {
    const manifestSource = readFileSync(
      path.join(process.cwd(), "lib/trader/market-data/dataset/fhv-dataset-manifest.ts"),
      "utf8",
    );
    expect(manifestSource).not.toMatch(/readFileSync|2025.*btc|2025.*eth|holdout.*\.json/i);
  });

  it("manifest holdout seal stays RESERVED_SEALED_NOT_ACCESSED for synthetic bars", () => {
    const bars = makeSyntheticBars(25);
    const integrity = assertIngestBarsIntegrity({
      bars,
      expectedSymbol: "BTC/USDT",
      expectedInterval: "1m",
    });
    expect(integrity.ok).toBe(true);
    if (!integrity.ok) {
      return;
    }

    const manifest = buildFhvDatasetManifest({
      sourceObjects: [...SYNTHETIC_SOURCE_PROVENANCE],
      bars,
      normalizedContentDigest: integrity.normalizedContentDigest,
      barSetDigest: integrity.barSetDigest,
      integrityResults: integrity.integrityResults,
      gaps: integrity.gaps,
      expectedBarCount: bars.length,
      intervalBoundaries: {
        startUtc: bars[0]!.barOpenTime,
        endUtc: bars.at(-1)!.barCloseTime,
      },
    });

    expect(manifest.holdoutSeal.contaminationStatus).toBe("RESERVED_SEALED_NOT_ACCESSED");
    expect(manifest.holdoutSeal.blindDigest).toBeUndefined();
    expect(manifest.partitions.blindHoldout.status).toBe("SEALED_NOT_ACCESSED");
  });

  it("uses only synthetic 2026 fixture bars — no 2025 holdout price reads", () => {
    const bars = makeSyntheticBars(25);
    expect(bars.every((bar) => bar.barOpenTime.startsWith("2026-"))).toBe(true);
    expect(bars.some((bar) => bar.barOpenTime.startsWith("2025-"))).toBe(false);
  });
});
