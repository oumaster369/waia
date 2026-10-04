import { describe, expect, it } from "vitest";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 } from "@/lib/trader/research/research-development-source-contract-v1";
import { captureResearchDevelopmentEvaluationClaimRequestV1 } from "@/lib/trader/research/research-development-evaluation-claim-contract-v1";

const attemptId = "a0000000-0000-4000-8000-000000001215";
const sourceId = `research-evaluation-source-v1:${"a".repeat(64)}`;
const input = (overrides: Record<string, unknown> = {}) => ({
  organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1,
  attemptId,
  evaluationSourceId: sourceId,
  commandId: "evaluation-claim:one",
  limits: { maxBars: 64, maxBytes: 2_000_000, maxTraceBytes: 2_000_000 },
  ...overrides,
});

describe("development evaluation claim request contract", () => {
  it("captures the fixed research organization and canonicalizes attempt UUID", () => {
    const captured = captureResearchDevelopmentEvaluationClaimRequestV1(input({
      attemptId: attemptId.toUpperCase(),
    }));
    expect(captured.organizationId).toBe(RESEARCH_DEVELOPMENT_SOURCE_ORG_V1);
    expect(captured.attemptId).toBe(attemptId);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.limits)).toBe(true);
  });

  it("accepts the inclusive operational limit bounds", () => {
    expect(captureResearchDevelopmentEvaluationClaimRequestV1(input({
      limits: { maxBars: 1, maxBytes: 1, maxTraceBytes: 1 },
    })).limits).toEqual({ maxBars: 1, maxBytes: 1, maxTraceBytes: 1 });
    expect(captureResearchDevelopmentEvaluationClaimRequestV1(input({
      limits: { maxBars: 4096, maxBytes: 32 * 1024 * 1024, maxTraceBytes: 32 * 1024 * 1024 },
    })).limits.maxBars).toBe(4096);
  });

  it.each([
    ["noncanonical organization casing", { organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1.toUpperCase() }],
    ["wrong valid organization", { organizationId: "11111111-1111-4111-8111-111111111111" }],
    ["unknown top-level field", { receiptDigest: "caller supplied" }],
    ["unknown nested limit", { limits: { maxBars: 1, maxBytes: 1, maxTraceBytes: 1, timeoutMs: 4 } }],
    ["invalid attempt UUID", { attemptId: "not-a-uuid" }],
    ["evaluation ID with uppercase hash", { evaluationSourceId: `research-evaluation-source-v1:${"A".repeat(64)}` }],
    ["evaluation ID with trailing newline", { evaluationSourceId: `${sourceId}\n` }],
    ["command ID with trailing newline", { commandId: "claim:one\n" }],
    ["empty command", { commandId: "" }],
    ["zero bars", { limits: { maxBars: 0, maxBytes: 1, maxTraceBytes: 1 } }],
    ["excess bars", { limits: { maxBars: 4097, maxBytes: 1, maxTraceBytes: 1 } }],
    ["fractional bytes", { limits: { maxBars: 1, maxBytes: 1.5, maxTraceBytes: 1 } }],
    ["excess trace bytes", { limits: { maxBars: 1, maxBytes: 1, maxTraceBytes: 32 * 1024 * 1024 + 1 } }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => captureResearchDevelopmentEvaluationClaimRequestV1(input(overrides))).toThrow();
  });

  it("detaches nested limits from later caller mutation", () => {
    const supplied = input({ limits: { maxBars: 8, maxBytes: 512, maxTraceBytes: 128 } }) as {
      organizationId: string; attemptId: string; evaluationSourceId: string; commandId: string;
      limits: { maxBars: number; maxBytes: number; maxTraceBytes: number };
    };
    const captured = captureResearchDevelopmentEvaluationClaimRequestV1(supplied);
    supplied.limits.maxBars = 64;
    supplied.commandId = "mutated-command";
    expect(captured.limits.maxBars).toBe(8);
    expect(captured.commandId).toBe("evaluation-claim:one");
  });
});
