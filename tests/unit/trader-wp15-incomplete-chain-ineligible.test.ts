import { describe, expect, it } from "vitest";

import { createInMemoryMkbReadModelSource } from "@/lib/trader/knowledge/mkb-read-model-source";
import { queryMkbReadModel } from "@/lib/trader/knowledge/mkb-read-model";
import { buildWp15Snapshot, WP15_AS_OF, WP15_ORG_A } from "./wp15-test-helpers";

describe("trader wp15 incomplete chain ineligible", () => {
  it("marks forecasts INELIGIBLE when WP14 decision is missing", async () => {
    const base = buildWp15Snapshot(WP15_ORG_A, "wp15-incomplete", "0");
    const snapshot = {
      ...base,
      decisions: [],
      links: [],
      entryPurposes: [],
    };

    const source = createInMemoryMkbReadModelSource({
      snapshotsByOrganizationId: { [WP15_ORG_A]: snapshot },
    });

    const result = await queryMkbReadModel(
      { organizationId: WP15_ORG_A },
      { runId: "wp15-incomplete", cycleId: "0", symbol: "BTC/USDT" },
      WP15_AS_OF,
      { source },
    );

    const forecastEntries = result.entries.filter((entry) => entry.subjectKind === "forecast");
    expect(forecastEntries.length).toBeGreaterThan(0);
    expect(forecastEntries.every((entry) => entry.knowledgeState === "INELIGIBLE")).toBe(true);
  });
});
