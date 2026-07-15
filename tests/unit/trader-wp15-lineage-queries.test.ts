import { describe, expect, it } from "vitest";

import {
  queryForecastDecisionLineage,
  queryHypothesisFamiliesByRegime,
  queryNoTradeObservations,
  queryPatternDiscoveryCandidates,
} from "@/lib/trader/knowledge/mkb-read-model-queries";
import { buildWp15Snapshot, WP15_AS_OF, WP15_ORG_A } from "./wp15-test-helpers";

describe("trader wp15 lineage queries", () => {
  it("returns forecast-decision lineage with chain completeness", () => {
    const snapshot = buildWp15Snapshot(WP15_ORG_A, "wp15-lineage", "0");
    const lineage = queryForecastDecisionLineage(snapshot, {
      runId: "wp15-lineage",
      cycleId: "0",
      symbol: "BTC/USDT",
    });

    expect(lineage).toHaveLength(1);
    expect(lineage[0]?.runId).toBe("wp15-lineage");
    expect(lineage[0]?.decisionRecordId).toBeTruthy();
    expect(typeof lineage[0]?.chainComplete).toBe("boolean");
  });

  it("returns no-trade observations for NO_TRADE decisions", () => {
    const snapshot = buildWp15Snapshot(WP15_ORG_A, "wp15-no-trade", "0");
    const observations = queryNoTradeObservations(snapshot, WP15_AS_OF, {
      runId: "wp15-no-trade",
    });

    if (snapshot.decisions[0]?.decisionClass === "NO_TRADE") {
      expect(observations.length).toBeGreaterThan(0);
      expect(observations[0]?.knowledgeState).toBe("OBSERVATION_ONLY");
    } else {
      expect(observations).toHaveLength(0);
    }
  });

  it("returns pattern discovery candidates from pattern edges", () => {
    const base = buildWp15Snapshot(WP15_ORG_A, "wp15-pattern", "0");
    const snapshot = {
      ...base,
      knowledgeEdges: [
        {
          id: "edge-pattern-1",
          organizationId: WP15_ORG_A,
          fromRef: "pattern:test@digest",
          toRef: "close:order:1",
          relationKind: "pattern_associated_with_close",
          confidence: "0.8",
          strength: "0.7",
          regimeScope: "trend_up",
          failureCasesJson: "[]",
          hypothesisId: null,
          verified: false,
          createdAt: new Date(Date.UTC(2024, 0, 1)),
          updatedAt: new Date(Date.UTC(2024, 0, 1)),
        },
      ],
    };

    const candidates = queryPatternDiscoveryCandidates(snapshot, WP15_AS_OF, {
      regimeScope: "trend_up",
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.relationKind).toBe("pattern_associated_with_close");
  });

  it("groups hypothesis families by regime", () => {
    const snapshot = buildWp15Snapshot(WP15_ORG_A, "wp15-regime", "0");
    const families = queryHypothesisFamiliesByRegime(snapshot, {
      runId: "wp15-regime",
    });

    expect(families.length).toBeGreaterThan(0);
    expect(families[0]?.hypothesisTypes.length).toBeGreaterThan(0);
  });
});
