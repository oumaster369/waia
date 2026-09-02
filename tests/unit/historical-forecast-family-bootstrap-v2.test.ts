import { describe, expect, it } from "vitest";

import { buildHistoricalForecastFamilyV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
import { computeReplicaRootFamilyIdentityDigest } from
  "@/lib/trader/intelligence/forecast-v2/identity-digests";

type FamilyInput = Parameters<typeof buildHistoricalForecastFamilyV2>[0];

const base: FamilyInput = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  symbol: "BTCUSDT" as const,
  primaryHorizonMinutes: 30 as const,
  developmentDatasetDigestHex: "a".repeat(64),
  releaseSha: "b".repeat(40),
};

describe("historical Forecast V2 family bootstrap", () => {
  it("builds a deterministic frozen identity from qualified production inputs", () => {
    const first = buildHistoricalForecastFamilyV2(base);
    const second = buildHistoricalForecastFamilyV2(base);
    expect(first).toEqual(second);
    expect(first.executionHorizonMinutes).toBe(33);
    expect(first.featureVersion).toBe("feature-engine/rv/v2");
    expect(computeReplicaRootFamilyIdentityDigest(first).toString("hex")).toHaveLength(64);
  });

  it("changes family identity across symbol, horizon, dataset, or release", () => {
    const identity = (patch: Partial<FamilyInput>) => computeReplicaRootFamilyIdentityDigest(
      buildHistoricalForecastFamilyV2({ ...base, ...patch }),
    ).toString("hex");
    const root = identity({});
    expect(identity({ symbol: "ETHUSDT" })).not.toBe(root);
    expect(identity({ primaryHorizonMinutes: 60 })).not.toBe(root);
    expect(identity({ developmentDatasetDigestHex: "c".repeat(64) })).not.toBe(root);
    expect(identity({ releaseSha: "d".repeat(40) })).not.toBe(root);
  });

  it("refuses placeholder-shaped invalid release and dataset identities", () => {
    expect(() => buildHistoricalForecastFamilyV2({ ...base, releaseSha: "main" }))
      .toThrow("HISTORICAL_FORECAST_FAMILY_REFUSED:IDENTITY");
    expect(() => buildHistoricalForecastFamilyV2({ ...base,
      developmentDatasetDigestHex: "not-a-digest" }))
      .toThrow("HISTORICAL_FORECAST_FAMILY_REFUSED:IDENTITY");
  });
});
