/**
 * HTR-WP12 — FHV dataset manifest digest + supersession contract.
 */
import { describe, expect, it } from "vitest";

import {
  buildFhvDatasetManifest,
  computeFhvDatasetManifestDigest,
  FHV_DATASET_MANIFEST_SCHEMA_VERSION,
} from "@/lib/trader/market-data/dataset/fhv-dataset-manifest";
import { assertIngestBarsIntegrity } from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import {
  loadMeanReversionFixture,
  makeSyntheticBars,
  SYNTHETIC_SOURCE_PROVENANCE,
} from "@/tests/unit/helpers/wp11-wp12-fixture";

describe("HTR-WP12 FHV dataset manifest", () => {
  it("buildFhvDatasetManifest is reproducible for bounded fixture input", () => {
    const fixture = loadMeanReversionFixture();
    const integrity = assertIngestBarsIntegrity({
      bars: fixture.bars,
      expectedSymbol: "BTC/USDT",
      expectedInterval: "1m",
    });
    expect(integrity.ok).toBe(true);
    if (!integrity.ok) {
      return;
    }

    const input = {
      sourceObjects: [...SYNTHETIC_SOURCE_PROVENANCE],
      bars: fixture.bars,
      normalizedContentDigest: integrity.normalizedContentDigest,
      barSetDigest: integrity.barSetDigest,
      integrityResults: integrity.integrityResults,
      gaps: integrity.gaps,
      expectedBarCount: fixture.bars.length,
      intervalBoundaries: {
        startUtc: fixture.bars[0]!.barOpenTime,
        endUtc: fixture.bars.at(-1)!.barCloseTime,
      },
    };

    const first = buildFhvDatasetManifest(input);
    const second = buildFhvDatasetManifest(input);

    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe(FHV_DATASET_MANIFEST_SCHEMA_VERSION);
    expect(first.manifestSemanticDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("manifestSemanticDigest excludes itself from digest input", () => {
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

    const { manifestSemanticDigest: _ignored, ...withoutDigest } = manifest;
    expect(manifest.manifestSemanticDigest).toBe(computeFhvDatasetManifestDigest(withoutDigest));
    expect(withoutDigest).not.toHaveProperty("manifestSemanticDigest");
  });

  it("supersedesDigest is included in semantic digest material", () => {
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

    const baseInput = {
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
    };

    const first = buildFhvDatasetManifest(baseInput);
    const second = buildFhvDatasetManifest({
      ...baseInput,
      manifestVersion: 2,
      supersedesDigest: first.manifestSemanticDigest,
    });

    expect(second.supersedesDigest).toBe(first.manifestSemanticDigest);
    expect(second.manifestVersion).toBe(2);
    expect(second.manifestSemanticDigest).not.toBe(first.manifestSemanticDigest);
  });
});
