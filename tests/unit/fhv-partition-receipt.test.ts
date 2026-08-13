import { describe, expect, it } from "vitest";

import {
  FHV_SCIENTIFIC_PARTITIONS_V1,
  buildFhvPartitionReceipt,
  readFhvPartitionReceipt,
} from "@/lib/trader/observability/fhv-partition-receipt";
import { qualifyFhvOfficialDataset } from "@/lib/trader/observability/fhv-dataset-qualification";
import {
  FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
  FHV_OFFICIAL_REAL_SCHEMA_ROOT,
} from "@/tests/helpers/fhv-official-path-test-fixtures";

describe("DEE-530 FHV partition receipts", () => {
  it("binds scientific partition intervals without holdout bar access", () => {
    expect(FHV_SCIENTIFIC_PARTITIONS_V1.WF_PREDICTIVE.endUtc).toBe("2024-01-01T00:00:00.000Z");
    expect(FHV_SCIENTIFIC_PARTITIONS_V1.WF_ECONOMIC.startUtc).toBe("2024-01-01T00:00:00.000Z");

    const holdout = buildFhvPartitionReceipt({
      partition: "BLIND_HOLDOUT",
      datasetContentDigest: "d".repeat(64),
      manifestSemanticDigest: "m".repeat(64),
      partitionsDigest: "p".repeat(64),
      holdoutSealDigest: "h".repeat(64),
      symbolEvidence: [
        {
          symbol: "BTCUSDT",
          barCount: null,
          contentDigest: null,
          firstBarOpenTime: null,
          lastBarCloseTime: null,
          dataAccess: "SEAL_ONLY",
        },
        {
          symbol: "ETHUSDT",
          barCount: null,
          contentDigest: null,
          firstBarOpenTime: null,
          lastBarCloseTime: null,
          dataAccess: "SEAL_ONLY",
        },
      ],
    });
    expect(holdout.accessPolicy).toBe("SEALED_NOT_ACCESSED");
    readFhvPartitionReceipt(holdout);
  });

  it("includes partition receipts in schema integration qualification output", () => {
    const body = qualifyFhvOfficialDataset({
      datasetRoot: FHV_OFFICIAL_REAL_SCHEMA_ROOT,
      manifestPath: FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
      qualificationMode: "SCHEMA_INTEGRATION_FIXTURE",
    });
    expect(body.partitionReceipts?.DEVELOPMENT?.partition).toBe("DEVELOPMENT");
    expect(body.partitionReceipts?.WF_PREDICTIVE?.partition).toBe("WF_PREDICTIVE");
    expect(body.partitionReceipts?.WF_ECONOMIC?.partition).toBe("WF_ECONOMIC");
    expect(
      body.partitionReceipts?.BLIND_HOLDOUT?.symbolEvidence.every(
        (entry) => entry.dataAccess === "SEAL_ONLY",
      ),
    ).toBe(true);
    expect(body.scientificPartitionsDigest).toMatch(/^[a-f0-9]{64}$/);
  });
});
