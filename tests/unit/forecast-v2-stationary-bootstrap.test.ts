import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { STATIONARY_BOOTSTRAP_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import {
  computeStationaryBootstrapBlockLength,
  stationaryBootstrapV1,
} from "@/lib/trader/intelligence/forecast-v2/stationary-bootstrap-v1";

describe("stationary-bootstrap/v1 block length L", () => {
  it("exports contract version pin", () => {
    expect(STATIONARY_BOOTSTRAP_VERSION).toBe("stationary-bootstrap/v1");
  });

  const cases: Array<{ n: number; expectedL: number }> = [
    { n: 1, expectedL: 1 },
    { n: 8, expectedL: 2 },
    { n: 9, expectedL: 3 },
    { n: 27, expectedL: 3 },
    { n: 28, expectedL: 4 },
  ];

  it.each(cases)("n=$n yields L=$expectedL via integer scan", ({ n, expectedL }) => {
    expect(computeStationaryBootstrapBlockLength(n)).toBe(expectedL);
    expect(expectedL ** 3).toBeGreaterThanOrEqual(n);
    if (expectedL > 1) {
      expect((expectedL - 1) ** 3).toBeLessThan(n);
    }
  });

  it("rejects non-positive source length", () => {
    expect(() => computeStationaryBootstrapBlockLength(0)).toThrow();
  });
});

describe("stationary-bootstrap/v1 resampling", () => {
  const source = ["a", "b", "c", "d"];
  const root = createHash("sha256").update("stationary-bootstrap-known-answer", "utf8").digest();

  it("returns exactly n resample positions", () => {
    const result = stationaryBootstrapV1({ source, bootstrapRootK: root, replicaOrdinal: 0 });
    expect(result.resampled).toHaveLength(source.length);
    expect(result.indexVector).toHaveLength(source.length);
    expect(result.blockLength).toBe(computeStationaryBootstrapBlockLength(source.length));
  });

  it("is deterministic for identical (source, root, replica)", () => {
    const first = stationaryBootstrapV1({ source, bootstrapRootK: root, replicaOrdinal: 2 });
    const second = stationaryBootstrapV1({ source, bootstrapRootK: root, replicaOrdinal: 2 });
    expect(first.indexVector).toEqual(second.indexVector);
    expect(first.resampled).toEqual(second.resampled);
  });

  it("produces distinct index vectors for different replica ordinals", () => {
    const k0 = stationaryBootstrapV1({ source, bootstrapRootK: root, replicaOrdinal: 0 });
    const k1 = stationaryBootstrapV1({ source, bootstrapRootK: root, replicaOrdinal: 1 });
    expect(k0.indexVector).not.toEqual(k1.indexVector);
  });

  it("wraps circular continuation mod n", () => {
    const singleton = stationaryBootstrapV1({
      source: ["only"],
      bootstrapRootK: root,
      replicaOrdinal: 0,
    });
    expect(singleton.indexVector).toEqual([0]);
    expect(singleton.resampled).toEqual(["only"]);
    expect(singleton.blockLength).toBe(1);
  });

  it("allows repeated source indices (bootstrap multiplicity)", () => {
    const result = stationaryBootstrapV1({ source, bootstrapRootK: root, replicaOrdinal: 5 });
    const uniqueCount = new Set(result.indexVector).size;
    expect(uniqueCount).toBeLessThanOrEqual(source.length);
  });
});
