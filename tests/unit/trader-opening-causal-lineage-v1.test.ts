import { describe, expect, it } from "vitest";
import { buildOpeningCausalLineageFromRiskAllowanceV2, buildOpeningCausalLineageV1, parseOpeningCausalLineageV1, serializeOpeningCausalLineageV1 } from "@/lib/trader/lifecycle/opening-causal-lineage-v1";

const d = (c: string) => c.repeat(64);
const draft = { organizationId: "org-a", symbol: "BTCUSDT", canonicalCausalLineageDigest: d("1"), forecastId: "forecast-a", forecastContentDigest: d("2"), decisionId: "decision-a", decisionContentDigest: d("3"), riskVerdictId: "verdict-a", riskAllowanceId: "allowance-a", riskAllowanceContentDigest: d("4") } as const;

describe("DEE-635 opening causal lineage V1", () => {
  it("is deterministic and canonical", () => {
    const first = buildOpeningCausalLineageV1(draft);
    const second = buildOpeningCausalLineageV1({ ...draft });
    expect(second).toEqual(first);
    expect(parseOpeningCausalLineageV1(serializeOpeningCausalLineageV1(first))).toEqual(first);
  });

  it("binds every causal authority reference", () => {
    const first = buildOpeningCausalLineageV1(draft);
    for (const [key, value] of Object.entries(draft)) {
      const mutated = buildOpeningCausalLineageV1({ ...draft, [key]: key.endsWith("Digest") ? d("a") : `${value}-changed` });
      expect(mutated.contentDigest).not.toBe(first.contentDigest);
    }
  });

  it("fails closed on mutation and non-canonical JSON", () => {
    const value = buildOpeningCausalLineageV1(draft);
    expect(() => parseOpeningCausalLineageV1(JSON.stringify({ ...value, decisionId: "other" }))).toThrow("DIGEST_MISMATCH");
    expect(() => parseOpeningCausalLineageV1(JSON.stringify({ extra: true, ...value }))).toThrow("UNEXPECTED_FIELD");
  });

  it("cross-binds the exact RiskAllowance V2 decision, risk and tenant scope", () => {
    const allowance = { organizationId: draft.organizationId, symbol: draft.symbol, riskAllowanceId: draft.riskAllowanceId, riskVerdictId: draft.riskVerdictId, contentDigestHex: draft.riskAllowanceContentDigest, decision: { decisionId: draft.decisionId, contentDigestHex: draft.decisionContentDigest } } as never;
    const input = { allowance, ...draft };
    expect(buildOpeningCausalLineageFromRiskAllowanceV2(input).riskAllowanceId).toBe(draft.riskAllowanceId);
    expect(() => buildOpeningCausalLineageFromRiskAllowanceV2({ ...input, organizationId: "other" })).toThrow("SCOPE_MISMATCH");
    expect(() => buildOpeningCausalLineageFromRiskAllowanceV2({ ...input, decisionId: "other" })).toThrow("DECISION_MISMATCH");
    expect(() => buildOpeningCausalLineageFromRiskAllowanceV2({ ...input, riskVerdictId: "other" })).toThrow("RISK_MISMATCH");
  });
});
