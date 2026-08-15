import { describe, expect, it } from "vitest";

import {
  buildFhvThroughputQualifierSamplerContract,
  FHV_THROUGHPUT_QUALIFIER_MAX_INTERVAL_MS,
  FHV_THROUGHPUT_QUALIFIER_SAMPLER_CONTRACT_VERSION,
  resolveFhvThroughputQualifierProgressIntervalMs,
} from "@/lib/trader/observability/fhv-throughput-sampler";
import { FHV_FULL_HISTORICAL_PROGRESS_INTERVAL_MS } from "@/lib/trader/observability/fhv-full-historical-progress";

describe("FHV throughput qualifier sampler contract", () => {
  it("binds a versioned contract and cannot be weakened by a slow inherited interval", () => {
    const contract = buildFhvThroughputQualifierSamplerContract({
      FHV_IDHPS_PROGRESS_INTERVAL_MS: "60000",
    });
    expect(contract.version).toBe(FHV_THROUGHPUT_QUALIFIER_SAMPLER_CONTRACT_VERSION);
    expect(contract.appliedIntervalMs).toBe(FHV_THROUGHPUT_QUALIFIER_MAX_INTERVAL_MS);
    expect(contract.appliedIntervalMs).toBeLessThan(FHV_FULL_HISTORICAL_PROGRESS_INTERVAL_MS);
  });

  it("allows a stronger (more frequent) inherited interval", () => {
    expect(
      resolveFhvThroughputQualifierProgressIntervalMs({ FHV_IDHPS_PROGRESS_INTERVAL_MS: "0" }),
    ).toBe(0);
  });

  it("clamps the observational default to the qualifier ceiling", () => {
    expect(resolveFhvThroughputQualifierProgressIntervalMs({})).toBe(
      FHV_THROUGHPUT_QUALIFIER_MAX_INTERVAL_MS,
    );
  });
});
