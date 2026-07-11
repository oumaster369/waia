import { describe, expect, it } from "vitest";

import {
  buildDiscoveryRunRecord,
  type DiscoveryRunRecord,
} from "../../scripts/trader/discovery-run";

describe("discovery-run frontmatter", () => {
  it("seals additive provenance on discovery run records", () => {
    const record: DiscoveryRunRecord = buildDiscoveryRunRecord(
      { skipped: true, reason: "discovery_run_disabled" },
      { runId: "campaign-uuid-407" },
    );

    expect(record.result.skipped).toBe(true);
    expect(record.frontmatter.runId).toBe("campaign-uuid-407");
    expect(record.frontmatter.executionOrigin).toBeTruthy();
    expect(record.frontmatter.environment).toBeTruthy();
    expect(record.frontmatter).toHaveProperty("gitSha");
    expect(record.frontmatter).toHaveProperty("dbConnectionMode");
  });
});
