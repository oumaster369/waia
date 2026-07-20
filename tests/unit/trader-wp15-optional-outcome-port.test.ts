import { describe, expect, it } from "vitest";

import { createInMemoryMkbReadModelSource } from "@/lib/trader/knowledge/mkb-read-model-source";
import { queryMkbReadModel } from "@/lib/trader/knowledge/mkb-read-model";
import type { OutcomeResolutionReadPort } from "@/lib/trader/knowledge/mkb-read-model.types";
import { buildWp15Snapshot, WP15_AS_OF, WP15_ORG_A } from "./wp15-test-helpers";

describe("trader wp15 optional outcome port", () => {
  it("defaults to UNRESOLVED without outcome port", async () => {
    const snapshot = buildWp15Snapshot(WP15_ORG_A, "wp15-no-port", "0");
    const source = createInMemoryMkbReadModelSource({
      snapshotsByOrganizationId: { [WP15_ORG_A]: snapshot },
    });

    const result = await queryMkbReadModel(
      { organizationId: WP15_ORG_A },
      { runId: "wp15-no-port", cycleId: "0", symbol: "BTC/USDT" },
      WP15_AS_OF,
      { source },
    );

    const forecastEntries = result.entries.filter((entry) => entry.subjectKind === "forecast");
    if (forecastEntries.length > 0) {
      expect(forecastEntries.some((entry) => entry.knowledgeState === "UNRESOLVED")).toBe(true);
    }
  });

  it("resolves forecasts when outcome port supplies verdicts", async () => {
    const snapshot = buildWp15Snapshot(WP15_ORG_A, "wp15-with-port", "0");
    const forecastId = snapshot.forecasts[0]?.id;
    expect(forecastId).toBeTruthy();

    const outcomePort: OutcomeResolutionReadPort = {
      async listResolvedOutcomes(context) {
        return [
          {
            organizationId: context.organizationId,
            forecastRecordId: forecastId!,
            resolvedAt: "2024-01-02T00:00:00.000Z",
            verdict: "CORRECT",
          },
        ];
      },
    };

    const source = createInMemoryMkbReadModelSource({
      snapshotsByOrganizationId: { [WP15_ORG_A]: snapshot },
    });

    const result = await queryMkbReadModel(
      { organizationId: WP15_ORG_A },
      { runId: "wp15-with-port", cycleId: "0", symbol: "BTC/USDT" },
      WP15_AS_OF,
      { source, outcomePort },
    );

    expect(
      result.entries.some(
        (entry) => entry.subjectId === forecastId && entry.knowledgeState === "RESOLVED_CORRECT",
      ),
    ).toBe(true);
  });
});
