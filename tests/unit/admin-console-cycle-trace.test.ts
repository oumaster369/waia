import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { assembleCycleTrace } from "@/lib/trader/admin-console/research/cycle-trace";

const EMPTY = {
  hypothesisId: null,
  forecastId: null,
  decisionId: null,
  riskVerdictId: null,
  executionPlanId: null,
  orderId: null,
  fillId: null,
};

describe("cycle trace from stored links", () => {
  it("marks only stages that have a stored record", () => {
    const empty = assembleCycleTrace(EMPTY);
    expect(empty).toHaveLength(23);
    expect(empty.every((stage) => stage.status === "unavailable")).toBe(true);
    const linked = assembleCycleTrace({
      ...EMPTY,
      hypothesisId: "h-1",
      forecastId: "f-1",
      decisionId: "d-1",
      riskVerdictId: "v-1",
      executionPlanId: "p-1",
      orderId: "o-1",
      fillId: "fill-1",
    });
    const completed = linked
      .filter((stage) => stage.status === "completed")
      .map((stage) => stage.stageId);
    expect(completed).toEqual([10, 11, 12, 13, 14, 15, 16]);
    expect(linked.find((stage) => stage.stageId === 4)?.reason).toBe("NOT_PERSISTED_FOR_CYCLE");
    expect(linked.find((stage) => stage.stageId === 17)?.reason).toBe("NOT_PERSISTED_FOR_CYCLE");
    expect(linked.find((stage) => stage.stageId === 16)?.sourceId).toBe("o-1");
  });

  it("does not select cycle payloads", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/trader/admin-console/handlers/cycle-trace.ts"),
      "utf8",
    );
    expect(source).not.toContain("input_causal_bundle_json");
    expect(source).not.toContain("canonical_causal_lineage_json");
    expect(source).not.toContain("receipt_json");
    expect(source).not.toContain("scenario_set_json");
    expect(source).not.toContain("exact_request_payload");
  });
});
