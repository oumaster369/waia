import { describe, expect, it } from "vitest";

import {
  assertProtectiveActionMandateV2,
  buildGuardianAssessmentV2,
  buildProtectiveActionMandateV2,
  routeGuardianOrdinaryAssessmentV2,
  type ProtectiveActionMandateV2Draft,
} from "@/lib/trader/guardian/v2";

const hex = (character: string) => character.repeat(64);
const assessment = (recommendation: "HOLD" | "REDUCE_PARTIAL" | "REDUCE_FULL") =>
  buildGuardianAssessmentV2({
    organizationId: "org-a", positionId: "position-a", lotId: "lot-a", symbol: "BTCUSDT",
    openingCausalLineageDigest: hex("1"), realityFrontierId: "reality-a",
    realityContentDigest: hex("2"), qualifiedEvidenceBundleId: "evidence-a",
    qualifiedEvidenceContentDigest: hex("3"), informationSufficiencyProfile: "OPEN_POSITION_REASSESSMENT",
    openPositionSufficiency: "SUFFICIENT", newOpportunitySufficiency: "INSUFFICIENT",
    recommendation, targetReductionBps: recommendation === "HOLD" ? 0 : recommendation === "REDUCE_FULL" ? 10_000 : 2_500,
    reasonCodes: ["THESIS_REASSESSED"],
  });

const draft = (overrides: Partial<ProtectiveActionMandateV2Draft> = {}): ProtectiveActionMandateV2Draft => ({
  organizationId: "org-a", positionId: "position-a", lotId: "lot-a", symbol: "BTCUSDT",
  openingCausalLineageDigest: hex("1"), guardianAssessmentId: assessment("HOLD").assessmentId,
  guardianAssessmentContentDigest: assessment("HOLD").contentDigest,
  decisionId: "decision-a", decisionContentDigest: hex("4"), actionKind: "REDUCE_PARTIAL",
  maximumReductionBps: 2_500, deterministicTriggerSpecDigest: hex("5"),
  validUntilUtc: "2026-08-31T00:00:00.000Z", ...overrides,
});

describe("Guardian V2 action authority", () => {
  it("routes ordinary reductions back through Decision V2 without executable authority", () => {
    expect(routeGuardianOrdinaryAssessmentV2(assessment("REDUCE_FULL"))).toMatchObject({
      route: "DECISION_V2_REQUIRED", recommendation: "REDUCE_FULL", maximumReductionBps: 10_000,
    });
    expect(routeGuardianOrdinaryAssessmentV2(assessment("HOLD"))).toMatchObject({ route: "NO_ACTION" });
  });

  it.each([
    ["REDUCE_PARTIAL", 0, "PROTECTIVE_MANDATE_PARTIAL_OUT_OF_RANGE"],
    ["REDUCE_PARTIAL", 10_000, "PROTECTIVE_MANDATE_PARTIAL_OUT_OF_RANGE"],
    ["CLOSE_FULL", 9_999, "PROTECTIVE_MANDATE_CLOSE_MUST_BE_FULL"],
    ["TIGHTEN_PROTECTION", 1, "PROTECTIVE_MANDATE_TIGHTEN_MUST_NOT_CHANGE_EXPOSURE"],
  ] as const)("rejects %s with reduction %s", (actionKind, maximumReductionBps, error) => {
    expect(() => buildProtectiveActionMandateV2(draft({ actionKind, maximumReductionBps }))).toThrow(error);
  });

  it("rejects add/reverse/amplify actions and any sealed-field mutation", () => {
    expect(() => buildProtectiveActionMandateV2(draft({ actionKind: "INCREASE" as never }))).toThrow(
      "PROTECTIVE_MANDATE_FORBIDDEN_ACTION",
    );
    const mandate = buildProtectiveActionMandateV2(draft());
    expect(() => assertProtectiveActionMandateV2({ ...mandate, decisionId: "decision-b" })).toThrow(
      "PROTECTIVE_MANDATE_DIGEST_MISMATCH",
    );
  });
});
