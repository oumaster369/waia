import { describe, expect, it } from "vitest";

import { createInMemoryMkbReadModelSource } from "@/lib/trader/knowledge/mkb-read-model-source";
import { queryMkbReadModel } from "@/lib/trader/knowledge/mkb-read-model";
import { buildWp15Snapshot, WP15_AS_OF, WP15_ORG_A } from "./wp15-test-helpers";

describe("trader wp15 no unresolved as knowledge", () => {
  it("excludes UNRESOLVED entries from verifiedKnowledge", async () => {
    const snapshot = buildWp15Snapshot(WP15_ORG_A, "wp15-unresolved", "0");
    const source = createInMemoryMkbReadModelSource({
      snapshotsByOrganizationId: { [WP15_ORG_A]: snapshot },
    });

    const result = await queryMkbReadModel(
      { organizationId: WP15_ORG_A },
      { runId: "wp15-unresolved", cycleId: "0", symbol: "BTC/USDT" },
      WP15_AS_OF,
      { source },
    );

    expect(result.entries.some((entry) => entry.knowledgeState === "UNRESOLVED")).toBe(true);
    expect(result.verifiedKnowledge.every((entry) => entry.knowledgeState !== "UNRESOLVED")).toBe(
      true,
    );
    expect(
      result.verifiedKnowledge.every(
        (entry) =>
          entry.knowledgeState !== "OBSERVATION_ONLY" && entry.knowledgeState !== "INELIGIBLE",
      ),
    ).toBe(true);
  });
});
