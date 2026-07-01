import { describe, expect, it } from "vitest";

import {
  DEFAULT_HTX_BACKFILL_TARGET_BARS,
  parseHtxKlineBackfillFlags,
  resolveHtxKlineBackfillConfig,
} from "../../scripts/trader/htx-kline-backfill";

describe("htx-kline-backfill CLI (RI-P7)", () => {
  it("defaults target-bars to 43200 (~30 days 1m)", () => {
    const flags = parseHtxKlineBackfillFlags(["--org-id=00000000-0000-4000-8000-0000000272"]);
    const config = resolveHtxKlineBackfillConfig(flags);
    expect(config.targetBarCount).toBe(DEFAULT_HTX_BACKFILL_TARGET_BARS);
    expect(config.size).toBe(2000);
  });

  it("accepts explicit target-bars override", () => {
    const flags = parseHtxKlineBackfillFlags([
      "--org-id=00000000-0000-4000-8000-0000000272",
      "--target-bars=129600",
    ]);
    const config = resolveHtxKlineBackfillConfig(flags);
    expect(config.targetBarCount).toBe(129_600);
  });
});
