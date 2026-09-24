import { describe, expect, it } from "vitest";

import { buildStrategyPromotionRequestBody } from "@/lib/trader/validation-gate/promotion-request-body";

const base = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  strategyId: "mean_reversion_v0",
  evidenceJson: '{"ok":true}',
  inputsJson: '{"strategyId":"mean_reversion_v0"}',
  idempotencyKey: "",
};

describe("strategy promotion request body", () => {
  it("includes research evidence when the JSON is present", () => {
    const result = buildStrategyPromotionRequestBody({
      ...base,
      researchEvidenceJson: '{"schema":"research-evidence"}',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.research_evidence).toEqual({ schema: "research-evidence" });
    expect(result.body.command).toBe("request");
    expect(result.body).not.toHaveProperty("expected_state_version");
    expect(result.body).not.toHaveProperty("idempotency_key");
  });

  it("rejects an empty research evidence field before POST", () => {
    const result = buildStrategyPromotionRequestBody({
      ...base,
      researchEvidenceJson: "   ",
    });
    expect(result).toEqual({
      ok: false,
      message: "Research evidence JSON must not be empty.",
    });
  });

  it("rejects invalid research evidence JSON before POST", () => {
    const result = buildStrategyPromotionRequestBody({
      ...base,
      researchEvidenceJson: "{",
    });
    expect(result).toEqual({
      ok: false,
      message: "Research evidence JSON is invalid.",
    });
  });
});
