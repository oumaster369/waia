import { describe, expect, it } from "vitest";

import { createInMemoryMkbReadModelSource } from "@/lib/trader/knowledge/mkb-read-model-source";
import { queryMkbReadModel } from "@/lib/trader/knowledge/mkb-read-model";
import { buildWp15Snapshot, WP15_AS_OF, WP15_ORG_A, WP15_ORG_B } from "./wp15-test-helpers";

describe("trader wp15 tenant boundary", () => {
  it("scopes read-model entries to requesting organization", async () => {
    const source = createInMemoryMkbReadModelSource({
      snapshotsByOrganizationId: {
        [WP15_ORG_A]: buildWp15Snapshot(WP15_ORG_A, "wp15-tenant-a", "0"),
        [WP15_ORG_B]: buildWp15Snapshot(WP15_ORG_B, "wp15-tenant-b", "0"),
      },
    });

    const orgA = await queryMkbReadModel(
      { organizationId: WP15_ORG_A },
      { runId: "wp15-tenant-a" },
      WP15_AS_OF,
      { source },
    );
    const orgB = await queryMkbReadModel(
      { organizationId: WP15_ORG_B },
      { runId: "wp15-tenant-b" },
      WP15_AS_OF,
      { source },
    );

    expect(orgA.entries.every((entry) => entry.organizationId === WP15_ORG_A)).toBe(true);
    expect(orgB.entries.every((entry) => entry.organizationId === WP15_ORG_B)).toBe(true);
    expect(orgA.entries.some((entry) => entry.runId === "wp15-tenant-a")).toBe(true);
    expect(orgA.entries.some((entry) => entry.runId === "wp15-tenant-b")).toBe(false);
  });
});
