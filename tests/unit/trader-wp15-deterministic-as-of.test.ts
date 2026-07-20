import { describe, expect, it } from "vitest";

import { createInMemoryMkbReadModelSource } from "@/lib/trader/knowledge/mkb-read-model-source";
import { queryMkbReadModel } from "@/lib/trader/knowledge/mkb-read-model";
import { buildWp15Snapshot, WP15_ORG_A } from "./wp15-test-helpers";

describe("trader wp15 deterministic as-of", () => {
  it("filters future-dated rows using explicit asOf only", async () => {
    const base = buildWp15Snapshot(WP15_ORG_A, "wp15-asof", "0");
    const snapshot = {
      ...base,
      marketEvents: [
        ...base.marketEvents,
        {
          id: "future-event",
          organizationId: WP15_ORG_A,
          eventKind: "future_event",
          subjectRef: "BTC/USDT",
          payloadJson: "{}",
          eventTime: new Date(Date.UTC(2025, 0, 1)),
          confidence: "0.5",
          contentDigest: "c".repeat(64),
          createdAt: new Date(Date.UTC(2025, 0, 1)),
        },
      ],
    };

    const source = createInMemoryMkbReadModelSource({
      snapshotsByOrganizationId: { [WP15_ORG_A]: snapshot },
    });

    const earlyAsOf = new Date(Date.UTC(2024, 0, 2, 0, 0, 0));
    const lateAsOf = new Date(Date.UTC(2025, 1, 1, 0, 0, 0));

    const early = await queryMkbReadModel(
      { organizationId: WP15_ORG_A },
      { runId: "wp15-asof" },
      earlyAsOf,
      { source },
    );
    const late = await queryMkbReadModel(
      { organizationId: WP15_ORG_A },
      { runId: "wp15-asof" },
      lateAsOf,
      { source },
    );

    expect(early.entries.some((entry) => entry.subjectId === "future-event")).toBe(false);
    expect(late.entries.some((entry) => entry.subjectId === "future-event")).toBe(true);
    expect(early.asOf).toBe(earlyAsOf.toISOString());
    expect(late.asOf).toBe(lateAsOf.toISOString());
  });
});
