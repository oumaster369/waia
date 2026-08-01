import { describe, expect, it } from "vitest";

import { runFhvDatasetQualification } from "@/scripts/trader/fhv-dataset-qualification-cli";
import { qualifyFhvOfficialDataset } from "@/lib/trader/observability/fhv-dataset-qualification";
import {
  FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
  FHV_OFFICIAL_REAL_SCHEMA_ROOT,
} from "@/tests/helpers/fhv-official-path-test-fixtures";

describe("DEE-436 FHV dataset qualification CLI", () => {
  it("passes bounded fixture qualification", () => {
    const result = runFhvDatasetQualification({ boundedFixture: true });
    expect(result.classification).toBe("DATASET_QUALIFICATION=PASS");
    expect(result.partitionsDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("passes official real-schema qualification from dataset-root", () => {
    const result = runFhvDatasetQualification({
      datasetRoot: FHV_OFFICIAL_REAL_SCHEMA_ROOT,
      manifestPath: FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
      qualificationMode: "SCHEMA_INTEGRATION_FIXTURE",
    });
    expect(result.classification).toBe("DATASET_QUALIFICATION=PASS");
    expect(result.datasetContentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.manifestSemanticDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails OFFICIAL_MULTI_YEAR on schema integration fixture (incomplete partitions)", () => {
    expect(() =>
      qualifyFhvOfficialDataset({
        datasetRoot: FHV_OFFICIAL_REAL_SCHEMA_ROOT,
        manifestPath: FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
        qualificationMode: "OFFICIAL_MULTI_YEAR",
      }),
    ).toThrow(/PARTITION_INCOMPLETE|PARTITION_COVERAGE_END_MISMATCH|must close at/i);
  });
});
