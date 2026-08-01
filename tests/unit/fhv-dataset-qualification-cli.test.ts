import { describe, expect, it } from "vitest";

import { runFhvDatasetQualification } from "@/scripts/trader/fhv-dataset-qualification-cli";

describe("DEE-436 FHV dataset qualification CLI", () => {
  it("passes bounded fixture qualification", () => {
    const result = runFhvDatasetQualification();
    expect(result.classification).toBe("DATASET_QUALIFICATION=PASS");
    expect(result.partitionsDigest).toMatch(/^[a-f0-9]{64}$/);
  });
});
