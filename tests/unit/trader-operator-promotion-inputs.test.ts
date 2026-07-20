import { describe, expect, it } from "vitest";

import type { PaperEvaluationExportDocument } from "@/lib/trader/paper/paper-evaluation-export.types";
import type { ResearchEvidenceDocument } from "@/lib/trader/research/research-evidence-export.types";
import { buildValidResearchEvidenceDocument } from "@/tests/helpers/build-research-evidence-fixture";
import {
  REQUIRED_EFFECTIVE_ACK,
  assertEffectiveAck,
  buildAssembleInput,
  OperatorRunwayInputError,
  parseOperatorPromotionInputs,
} from "@/lib/trader/validation-gate/operator-promotion-inputs";

const ORG = "00000000-0000-4000-8000-0000000277i";

function validInputObject(): Record<string, unknown> {
  return {
    strategyId: "mean_reversion_v0",
    strategyVersion: "0.1.0",
    gitCommitSha: "fa63f09661884594f0a8f7e2aab4d46bfda21cde",
    hypothesis: "Mean reversion in range",
    intendedRegime: "RANGE",
    costModel: { feesBps: "10", slippageBps: "25", notes: "conservative" },
    failureModes: ["liquidity vacuum -> exposure cap"],
    reasonCodeDistribution: { STRAT_MR_ZSCORE_BUY: 3 },
    confidenceAttestation: {
      edgeNetOfCosts: "Net edge after costs.",
      liveTracksPaper: "Live should track paper.",
      downsideRiskBounded: "Risk engine caps downside.",
    },
  };
}

function parse(obj: unknown) {
  return parseOperatorPromotionInputs(JSON.stringify(obj));
}

/** Returns the thrown error's `code`, or fails if nothing was thrown. */
function thrownCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  throw new Error("expected the function to throw");
}

describe("operator promotion inputs (DEE-277 S2)", () => {
  it("parses a fully valid input object", () => {
    const inputs = parse(validInputObject());
    expect(inputs.strategyId).toBe("mean_reversion_v0");
    expect(inputs.costModel.feesBps).toBe("10");
    expect(inputs.costModel.slippageBps).toBe("25");
    expect(inputs.failureModes).toHaveLength(1);
    expect(inputs.reasonCodeDistribution.STRAT_MR_ZSCORE_BUY).toBe(3);
  });

  it("rejects malformed JSON", () => {
    expect(thrownCode(() => parseOperatorPromotionInputs("{nope"))).toBe(
      "OPERATOR_INPUTS_MALFORMED_JSON",
    );
  });

  it("rejects a non-object payload", () => {
    expect(thrownCode(() => parseOperatorPromotionInputs("42"))).toBe("OPERATOR_INPUTS_NOT_OBJECT");
  });

  it("rejects unknown top-level keys", () => {
    expect(thrownCode(() => parse({ ...validInputObject(), surpriseScore: 999 }))).toBe(
      "OPERATOR_INPUTS_UNKNOWN_KEY",
    );
  });

  it("rejects unknown cost-model keys", () => {
    const obj = validInputObject();
    (obj.costModel as Record<string, unknown>).edgeThreshold = "0.5";
    expect(thrownCode(() => parse(obj))).toBe("OPERATOR_INPUTS_COST_MODEL_UNKNOWN_KEY");
  });

  it.each(["strategyId", "strategyVersion", "gitCommitSha", "hypothesis", "intendedRegime"])(
    "rejects missing field: %s",
    (field) => {
      const obj = validInputObject();
      delete obj[field];
      expect(() => parse(obj)).toThrowError(OperatorRunwayInputError);
    },
  );

  it.each(["strategyId", "strategyVersion", "gitCommitSha", "hypothesis", "intendedRegime"])(
    "rejects empty field: %s",
    (field) => {
      const obj = validInputObject();
      obj[field] = "   ";
      expect(() => parse(obj)).toThrowError(OperatorRunwayInputError);
    },
  );

  it("requires costModel.feesBps", () => {
    const obj = validInputObject();
    delete (obj.costModel as Record<string, unknown>).feesBps;
    expect(thrownCode(() => parse(obj))).toBe("OPERATOR_INPUTS_COST_MODEL_FEES_REQUIRED");
  });

  it("requires costModel.slippageBps", () => {
    const obj = validInputObject();
    delete (obj.costModel as Record<string, unknown>).slippageBps;
    expect(thrownCode(() => parse(obj))).toBe("OPERATOR_INPUTS_COST_MODEL_SLIPPAGE_REQUIRED");
  });

  it("rejects empty failureModes", () => {
    expect(thrownCode(() => parse({ ...validInputObject(), failureModes: [] }))).toBe(
      "OPERATOR_INPUTS_FAILURE_MODES_REQUIRED",
    );
  });

  it("rejects a non-string failure mode", () => {
    expect(() => parse({ ...validInputObject(), failureModes: [123] })).toThrowError(
      OperatorRunwayInputError,
    );
  });

  it("rejects empty reasonCodeDistribution", () => {
    expect(thrownCode(() => parse({ ...validInputObject(), reasonCodeDistribution: {} }))).toBe(
      "OPERATOR_INPUTS_REASON_CODES_REQUIRED",
    );
  });

  it("rejects non-integer reason-code counts", () => {
    expect(
      thrownCode(() => parse({ ...validInputObject(), reasonCodeDistribution: { X: 1.5 } })),
    ).toBe("OPERATOR_INPUTS_REASON_CODE_COUNT_INVALID");
  });

  it("rejects missing confidence attestation field", () => {
    const obj = validInputObject();
    delete (obj.confidenceAttestation as Record<string, unknown>).edgeNetOfCosts;
    expect(thrownCode(() => parse(obj))).toBe("OPERATOR_INPUTS_ATTESTATION_EDGE_REQUIRED");
  });

  it("rejects unknown attestation keys", () => {
    const obj = validInputObject();
    (obj.confidenceAttestation as Record<string, unknown>).rating = "1500";
    expect(thrownCode(() => parse(obj))).toBe("OPERATOR_INPUTS_ATTESTATION_UNKNOWN_KEY");
  });

  describe("assertEffectiveAck", () => {
    it("accepts the exact phrase", () => {
      expect(REQUIRED_EFFECTIVE_ACK).toBe(
        "I confirm the paper evidence exceeds Accelerated Historical Replay Validation plumbing evidence alone",
      );
      expect(() => assertEffectiveAck(REQUIRED_EFFECTIVE_ACK)).not.toThrow();
    });
    it("rejects a wrong/empty phrase", () => {
      expect(thrownCode(() => assertEffectiveAck("yes"))).toBe("OPERATOR_RUNWAY_ACK_REQUIRED");
      expect(thrownCode(() => assertEffectiveAck(undefined))).toBe("OPERATOR_RUNWAY_ACK_REQUIRED");
    });
  });

  describe("buildAssembleInput", () => {
    const document = {
      schemaVersion: "waia.trader.paper-evaluation-export.v1",
      envelope: { organizationId: ORG },
    } as unknown as PaperEvaluationExportDocument;
    const researchEvidenceDocument = buildValidResearchEvidenceDocument(
      ORG,
    ) as ResearchEvidenceDocument;

    it("builds an assembly input when orgs match", () => {
      const inputs = parse(validInputObject());
      const assembly = buildAssembleInput({
        organizationId: ORG,
        inputs,
        document,
        researchEvidenceDocument,
      });
      expect(assembly.organizationId).toBe(ORG);
      expect(assembly.paperTradingEvidenceDocument).toBe(document);
    });

    it("rejects evidence org mismatch", () => {
      const inputs = parse(validInputObject());
      expect(
        thrownCode(() =>
          buildAssembleInput({
            organizationId: "other-org",
            inputs,
            document,
            researchEvidenceDocument,
          }),
        ),
      ).toBe("OPERATOR_EVIDENCE_ORG_MISMATCH");
    });

    it("rejects inputs org mismatch", () => {
      const inputs = parse({ ...validInputObject(), organizationId: "different-org" });
      expect(
        thrownCode(() =>
          buildAssembleInput({
            organizationId: ORG,
            inputs,
            document,
            researchEvidenceDocument,
          }),
        ),
      ).toBe("OPERATOR_INPUTS_ORG_MISMATCH");
    });
  });
});
