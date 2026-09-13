import { describe, expect, it } from "vitest";
import { historicalDatasetRegistrationIdentityV2 } from
  "@/lib/trader/historical-simulation-v2/dataset-registration-identity-v2";

const input = { organizationId: "3c50b4e9-1138-43a5-a29f-e65088124cfc", runId: "run-a",
  cycleId: "run-a:WALK_FORWARD:BTCUSDT:1000", authorityContentDigestHex: "a".repeat(64) };
describe("historical dataset registration identity", () => {
  it("is stable across independent calls and property insertion order", () => {
    const id = historicalDatasetRegistrationIdentityV2(input);
    expect(id).toBe("9ce6226e-7646-5497-a3ac-9ce5d09d2c5d");
    expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(historicalDatasetRegistrationIdentityV2({ authorityContentDigestHex: input.authorityContentDigestHex,
      cycleId: input.cycleId, runId: input.runId, organizationId: input.organizationId })).toBe(id);
  });
  it.each([
    { organizationId: "4c50b4e9-1138-43a5-a29f-e65088124cfc" },
    { runId: "run-b" }, { cycleId: "run-a:WALK_FORWARD:BTCUSDT:1001" },
    { authorityContentDigestHex: "b".repeat(64) },
  ])("separates every authority binding %j", change => {
    expect(historicalDatasetRegistrationIdentityV2({ ...input, ...change }))
      .not.toBe(historicalDatasetRegistrationIdentityV2(input));
  });
  it.each([
    { organizationId: "not-a-uuid" }, { runId: "" }, { runId: " run-a" }, { cycleId: "" },
    { authorityContentDigestHex: "a".repeat(63) }, { authorityContentDigestHex: "X".repeat(64) },
  ])("rejects incomplete bindings %j", change => {
    expect(() => historicalDatasetRegistrationIdentityV2({ ...input, ...change })).toThrow(/IDENTITY_INVALID/);
  });
});
