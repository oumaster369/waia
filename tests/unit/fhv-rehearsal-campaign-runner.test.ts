import { afterEach, describe, expect, it, vi } from "vitest";

import { runFhvRehearsalCampaign } from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";

const INPUT = {
  runRoot: "/does-not-need-to-exist",
  runId: "fhv-hermetic-pause-guard",
  organizationId: "00000000-0000-4000-8000-000000000431",
  targetSha: "cccccccccccccccccccccccccccccccccccccccc",
} as const;

describe("FHV rehearsal campaign hermetic pause boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when the test-only pause control is used outside test", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      runFhvRehearsalCampaign({
        ...INPUT,
        testOnlyPauseAfterCycles: 45,
      }),
    ).rejects.toMatchObject({ code: "REHEARSAL_TEST_ONLY_PAUSE_FORBIDDEN" });
  });

  it.each([0, -1, 1.5])("rejects invalid test-only pause cycle %s", async (cycle) => {
    vi.stubEnv("NODE_ENV", "test");

    await expect(
      runFhvRehearsalCampaign({
        ...INPUT,
        testOnlyPauseAfterCycles: cycle,
      }),
    ).rejects.toMatchObject({ code: "REHEARSAL_TEST_ONLY_PAUSE_INVALID" });
  });
});
