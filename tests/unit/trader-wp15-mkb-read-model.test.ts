import { describe, expect, it } from "vitest";

import { createInMemoryMkbReadModelSource } from "@/lib/trader/knowledge/mkb-read-model-source";
import { queryMkbReadModel } from "@/lib/trader/knowledge/mkb-read-model";
import { MKB_READ_MODEL_SCHEMA_VERSION } from "@/lib/trader/knowledge/mkb-read-model.types";
import { buildWp15Snapshot, WP15_AS_OF, WP15_ORG_A } from "./wp15-test-helpers";

describe("trader wp15 mkb read model", () => {
  it("returns schema version, entries, verifiedKnowledge and semantic digest", async () => {
    const snapshot = buildWp15Snapshot(WP15_ORG_A, "wp15-run", "0");
    const source = createInMemoryMkbReadModelSource({
      snapshotsByOrganizationId: { [WP15_ORG_A]: snapshot },
    });

    const result = await queryMkbReadModel(
      { organizationId: WP15_ORG_A },
      { runId: "wp15-run", cycleId: "0", symbol: "BTC/USDT" },
      WP15_AS_OF,
      { source },
    );

    expect(result.schemaVersion).toBe(MKB_READ_MODEL_SCHEMA_VERSION);
    expect(result.asOf).toBe(WP15_AS_OF.toISOString());
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.semanticDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.entries.every((entry) => entry.asOf === WP15_AS_OF.toISOString())).toBe(true);
  });

  it("is byte-identical across replay generations", async () => {
    const snapshot = buildWp15Snapshot(WP15_ORG_A, "wp15-parity", "0");
    const source = createInMemoryMkbReadModelSource({
      snapshotsByOrganizationId: { [WP15_ORG_A]: snapshot },
    });
    const query = { runId: "wp15-parity", cycleId: "0", symbol: "BTC/USDT" };

    const one = await queryMkbReadModel({ organizationId: WP15_ORG_A }, query, WP15_AS_OF, {
      source,
    });
    const two = await queryMkbReadModel({ organizationId: WP15_ORG_A }, query, WP15_AS_OF, {
      source,
    });

    expect(one).toEqual(two);
  });
});
