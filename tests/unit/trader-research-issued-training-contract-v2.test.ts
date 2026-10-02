import { describe, expect, it } from "vitest";
import {
  captureResearchIssuedTrainingRequestV2,
} from "@/lib/trader/research/research-issued-training-contract-v2";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 } from "@/lib/trader/research/research-development-source-contract-v1";

type RequestInput = {
  organizationId: string;
  attemptId: string;
  trialIndex: number;
  limits: { maxBars: number; maxBytes: number };
};

function request(overrides: Record<string, unknown> = {}): RequestInput {
  return {
    organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1,
    attemptId: "a0000000-0000-4000-8000-000000001212",
    trialIndex: 0,
    limits: { maxBars: 64, maxBytes: 2_000_000 },
    ...overrides,
  } as RequestInput;
}

describe("issued training V2 request contract", () => {
  it("captures Org0 requests and normalizes both UUIDs to lowercase", () => {
    const captured = captureResearchIssuedTrainingRequestV2(request({
      organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1.toUpperCase(),
      attemptId: "A0000000-0000-4000-8000-000000001212",
    }));

    expect(captured.organizationId).toBe(RESEARCH_DEVELOPMENT_SOURCE_ORG_V1);
    expect(captured.attemptId).toBe("a0000000-0000-4000-8000-000000001212");
  });

  it("rejects unknown top-level and nested limit fields", () => {
    expect(() => captureResearchIssuedTrainingRequestV2(request({ unexpected: true }))).toThrow();
    expect(() => captureResearchIssuedTrainingRequestV2(request({
      limits: { maxBars: 64, maxBytes: 2_000_000, timeoutMs: 100 },
    }))).toThrow();
  });

  it("accepts only the configured Org0 even when the other UUID is valid", () => {
    expect(() => captureResearchIssuedTrainingRequestV2(request({
      organizationId: "a0000000-0000-4000-8000-000000001212",
    }))).toThrow();
  });

  it.each([
    [0, 1, 1],
    [31, 4096, 32 * 1024 * 1024],
  ])("accepts documented integer bounds trial=%i bars=%i bytes=%i", (trialIndex, maxBars, maxBytes) => {
    const captured = captureResearchIssuedTrainingRequestV2(request({
      trialIndex, limits: { maxBars, maxBytes },
    }));
    expect(captured).toMatchObject({ trialIndex, limits: { maxBars, maxBytes } });
  });

  it.each([
    ["trial below range", { trialIndex: -1 }],
    ["trial above range", { trialIndex: 32 }],
    ["fractional trial", { trialIndex: 0.5 }],
    ["zero bars", { limits: { maxBars: 0, maxBytes: 1 } }],
    ["too many bars", { limits: { maxBars: 4097, maxBytes: 1 } }],
    ["fractional bars", { limits: { maxBars: 1.5, maxBytes: 1 } }],
    ["zero bytes", { limits: { maxBars: 1, maxBytes: 0 } }],
    ["too many bytes", { limits: { maxBars: 1, maxBytes: 32 * 1024 * 1024 + 1 } }],
    ["fractional bytes", { limits: { maxBars: 1, maxBytes: 1.5 } }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => captureResearchIssuedTrainingRequestV2(request(overrides))).toThrow();
  });

  it("detaches and freezes the validated request before caller mutation", () => {
    const input = request({
      attemptId: "A0000000-0000-4000-8000-000000001212",
      limits: { maxBars: 7, maxBytes: 900 },
    });
    const captured = captureResearchIssuedTrainingRequestV2(input);

    input.organizationId = "a0000000-0000-4000-8000-000000001212";
    input.attemptId = "b0000000-0000-4000-8000-000000001212";
    input.trialIndex = 15;
    (input.limits as { maxBars: number; maxBytes: number }).maxBars = 99;

    expect(captured).toEqual({
      organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1,
      attemptId: "a0000000-0000-4000-8000-000000001212",
      trialIndex: 0,
      limits: { maxBars: 7, maxBytes: 900 },
    });
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.limits)).toBe(true);
  });
});
