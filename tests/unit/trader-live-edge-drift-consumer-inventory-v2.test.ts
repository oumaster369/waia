import { describe, expect, it } from "vitest";

import { isLiveEdgeDriftCapitalConsumerForbiddenV2 } from "@/lib/trader/restriction";

describe("DEE-774 live-edge drift consumer inventory", () => {
  it("forbids Execution/live/capital/holdout consumers from treating drift as permission", () => {
    expect(isLiveEdgeDriftCapitalConsumerForbiddenV2("lib/trader/execution/submit.ts")).toBe(true);
    expect(isLiveEdgeDriftCapitalConsumerForbiddenV2("lib/trader/live/enable.ts")).toBe(true);
    expect(
      isLiveEdgeDriftCapitalConsumerForbiddenV2(
        "lib/trader/runtime-authority/v2/runtime-authority-assessment-v2.ts",
      ),
    ).toBe(false);
  });
});
