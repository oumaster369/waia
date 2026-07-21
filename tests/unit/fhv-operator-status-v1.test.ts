import { describe, expect, it } from "vitest";

import {
  buildFhvOperatorStatusV1,
  enforceFhvOperatorStatusSizeCap,
} from "@/lib/trader/observability/build-fhv-operator-status-v1";
import {
  FHV_OPERATOR_STATUS_MAX_BYTES,
  FHV_OPERATOR_STATUS_SCHEMA_VERSION,
} from "@/lib/trader/observability/fhv-observability.constants";
import type { FhvBoundedSummaryItem } from "@/lib/trader/observability/fhv-operator-status-v1.types";

const BASE_INPUT = {
  runId: "dee-416-status-run",
  phase: "REPLAY",
  codeSha: "sha416",
  artifactDigest: "artifact-digest",
  datasetSeal: "dataset-seal",
  datasetDigest: "dataset-digest",
  configurationDigest: "config-digest",
} as const;

function summaryItem(id: string, label: string): FhvBoundedSummaryItem {
  return {
    id,
    label,
    atUtc: "2026-07-21T00:00:00.000Z",
    artifactRef: `fhv-artifact/v1/alerts/${id}`,
  };
}

describe("DEE-416 FHV operator status v1", () => {
  it("pins schema version on built status", () => {
    const status = buildFhvOperatorStatusV1(BASE_INPUT);
    expect(status.schemaVersion).toBe(FHV_OPERATOR_STATUS_SCHEMA_VERSION);
    expect(status.schemaVersion).toBe("fhv-operator-status/v1");
  });

  it("passes through status under the 256KiB cap unchanged", () => {
    const status = buildFhvOperatorStatusV1(BASE_INPUT);
    const capped = enforceFhvOperatorStatusSizeCap(status);
    expect(capped).toBe(status);
    expect(Buffer.byteLength(JSON.stringify(capped), "utf8")).toBeLessThanOrEqual(
      FHV_OPERATOR_STATUS_MAX_BYTES,
    );
  });

  it("trims bounded summaries when serialized status exceeds 256KiB", () => {
    const base = buildFhvOperatorStatusV1(BASE_INPUT);
    const oversizedAlerts = Array.from({ length: 500 }, (_, index) =>
      summaryItem(`alert-${index}`, "x".repeat(512)),
    );
    const status = {
      ...base,
      recentAlerts: oversizedAlerts,
      marketIntelligence: {
        ...base.marketIntelligence,
        activeHypothesesSummary: oversizedAlerts,
        competingHypothesesSummary: oversizedAlerts,
        vetoesSummary: oversizedAlerts,
      },
      tradingSimulation: {
        ...base.tradingSimulation,
        recentOrdersSummary: oversizedAlerts,
        recentFillsSummary: oversizedAlerts,
        openPositionsSummary: oversizedAlerts,
      },
      evidence: {
        ...base.evidence,
        recentEvidenceEventIds: oversizedAlerts.map((item) => item.id),
      },
    };
    const rawBytes = Buffer.byteLength(JSON.stringify(status), "utf8");
    expect(rawBytes).toBeGreaterThan(FHV_OPERATOR_STATUS_MAX_BYTES);

    const capped = enforceFhvOperatorStatusSizeCap(status);
    expect(capped.recentAlerts.length).toBeLessThan(status.recentAlerts.length);
    expect(Buffer.byteLength(JSON.stringify(capped), "utf8")).toBeLessThanOrEqual(
      FHV_OPERATOR_STATUS_MAX_BYTES,
    );
  });

  it("throws when non-trimmable fields exceed the 256KiB cap", () => {
    const status = buildFhvOperatorStatusV1(BASE_INPUT);
    const bloated = {
      ...status,
      campaign: {
        ...status.campaign,
        runId: "x".repeat(FHV_OPERATOR_STATUS_MAX_BYTES),
      },
    };
    expect(() => enforceFhvOperatorStatusSizeCap(bloated)).toThrow(
      "FHV_OPERATOR_STATUS_SIZE_CAP_EXCEEDED",
    );
  });
});
