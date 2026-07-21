import { describe, expect, it } from "vitest";

import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";
import { FHV_STATUS_MAX_RECENT_ALERTS } from "@/lib/trader/observability/fhv-observability.constants";
import type { FhvBoundedSummaryItem } from "@/lib/trader/observability/fhv-operator-status-v1.types";

const BASE_INPUT = {
  runId: "dee-416-build-run",
  phase: "REPLAY",
  codeSha: "sha416build",
  artifactDigest: "artifact-digest",
  datasetSeal: "dataset-seal",
  datasetDigest: "dataset-digest",
  configurationDigest: "config-digest",
} as const;

function alertSummary(index: number): FhvBoundedSummaryItem {
  return {
    id: `FHV-ALERT-${String(index).padStart(3, "0")}`,
    label: `alert ${index}`,
    atUtc: "2026-07-21T00:00:00.000Z",
    artifactRef: `fhv-artifact/v1/alerts/${index}`,
  };
}

describe("DEE-416 build FHV operator status v1", () => {
  it("truncates recentAlerts to the bounded summary limit", () => {
    const alerts = Array.from({ length: FHV_STATUS_MAX_RECENT_ALERTS + 15 }, (_, index) =>
      alertSummary(index),
    );
    const status = buildFhvOperatorStatusV1({
      ...BASE_INPUT,
      recentAlerts: alerts,
    });
    expect(status.recentAlerts).toHaveLength(FHV_STATUS_MAX_RECENT_ALERTS);
    expect(status.recentAlerts[0]?.id).toBe("FHV-ALERT-000");
    expect(status.recentAlerts.at(-1)?.id).toBe(
      `FHV-ALERT-${String(FHV_STATUS_MAX_RECENT_ALERTS - 1).padStart(3, "0")}`,
    );
  });

  it("keeps empty bounded summaries at zero length", () => {
    const status = buildFhvOperatorStatusV1(BASE_INPUT);
    expect(status.marketIntelligence.activeHypothesesSummary).toEqual([]);
    expect(status.marketIntelligence.competingHypothesesSummary).toEqual([]);
    expect(status.tradingSimulation.recentOrdersSummary).toEqual([]);
    expect(status.tradingSimulation.recentFillsSummary).toEqual([]);
    expect(status.evidence.recentEvidenceEventIds).toEqual([]);
  });

  it("defaults holdout gate to closed with dataset digest", () => {
    const status = buildFhvOperatorStatusV1({
      ...BASE_INPUT,
      holdoutDatasetDigest: "holdout-digest-416",
    });
    expect(status.holdout.holdoutGate).toBe("CLOSED");
    expect(status.holdout.holdoutState).toBe("SEALED_NOT_ACCESSED");
    expect(status.holdout.holdoutDatasetDigest).toBe("holdout-digest-416");
    expect(status.holdout.holdoutAccess).toBe("PROHIBITED_UNTIL_OPERATOR_PROCEDURE");
  });
});
