import { describe, expect, it, vi } from "vitest";

import {
  computeInquiryContentDigest,
  type InformationAcquisitionSelectionV1,
} from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import { runInformationInquiryRuntimeV1 } from "@/lib/trader/intelligence/information-inquiry/information-inquiry-runtime-v1";
import { buildInformationNeedPlanningBundleV1 } from "@/lib/trader/intelligence/information-inquiry/information-need-planner-v1";
import {
  assertInformationSufficiencyReceiptV2,
  bindInformationSufficiencyReceiptAuthorityV2,
  evaluateInformationSufficiencyRuntimeAdmissionV2,
  type InformationEvidenceV2,
  type InformationSufficiencyReceiptV2,
  type InformationSufficiencyRuntimeAuthorityV2,
  type RequiredInformationProfileV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import { INFORMATION_ACQUISITION_RECEIPT_V1_SCHEMA_VERSION } from "@/lib/trader/market-data/types";
import beforeFix from "@/tests/fixtures/sufficiency/dee1118-before-fix.json";
import {
  contradictionEvidence, contradictionPlanningInput, contradictionProfile,
  evaluateContradiction, sufficiencyHex, SUFFICIENCY_PIT,
} from "@/tests/helpers/sufficiency-contradiction";

const good = contradictionEvidence("good", "SUPPORTS");
const unresolved = contradictionEvidence("unresolved", "UNRESOLVED");

function admit(authority: InformationSufficiencyRuntimeAuthorityV2) {
  return evaluateInformationSufficiencyRuntimeAdmissionV2({
    authority, organizationId: "org-contradiction", requiredPurpose: "NEW_OPPORTUNITY",
    allowResearchNonCapital: false,
    expectedScope: { accountId: "account-contradiction", symbol: "BTC/USDT",
      analyticalTimeframe: "1m", pitAnchor: SUFFICIENCY_PIT },
  });
}

describe("DEE1118 required unresolved contradiction veto", () => {
  it.each(["NEW_OPPORTUNITY", "OPEN_POSITION_REASSESSMENT", "RESEARCH_NON_CAPITAL"] as const)(
    "vetoes mixed evidence within its own %s profile", (purpose) => {
      const profile = contradictionProfile({}, { purpose });
      const receipt = evaluateContradiction(profile, [good, unresolved]);
      expect(receipt.status).toBe("INSUFFICIENT");
      expect(receipt.requirementReceipts[0]).toMatchObject({
        terminalStatus: "UNRESOLVED_CONTRADICTION", active: true, blocking: true,
        acceptedEvidenceIds: ["good"], effectiveIndependentGroups: ["source-group"],
        reasonCodes: ["EVIDENCE_CONTRADICTION_UNRESOLVED"],
      });
      expect(receipt.reasonCodes).toContain("EVIDENCE_CONTRADICTION_UNRESOLVED");
      expect(assertInformationSufficiencyReceiptV2(receipt, profile)).toEqual(receipt);
      if (purpose === "NEW_OPPORTUNITY") {
        expect(admit(bindInformationSufficiencyReceiptAuthorityV2(profile, receipt))).toMatchObject({
          status: "BLOCKED", reasonCode: "INSUFFICIENT", createsCapitalAuthority: false,
        });
      }
    },
  );

  it("preserves optional nonblocking and inactive context semantics", () => {
    const optional = contradictionProfile({ classification: "OPTIONAL_ENRICHMENT" });
    const optionalReceipt = evaluateContradiction(optional, [good, unresolved]);
    expect(optionalReceipt.status).toBe("SUFFICIENT");
    expect(optionalReceipt.requirementReceipts[0]).toMatchObject({
      terminalStatus: "UNRESOLVED_CONTRADICTION", blocking: false,
    });
    expect(admit(bindInformationSufficiencyReceiptAuthorityV2(optional, optionalReceipt)).status)
      .toBe("ADMITTED");
    // Optionality removes the sufficiency veto, not the planner's independent
    // exact-lineage requirement for an unresolved contradiction terminal.
    expect(() => buildInformationNeedPlanningBundleV1(
      contradictionPlanningInput(optional, optionalReceipt, false),
    )).toThrow("missingContradictionLineage");
    const context = contradictionProfile({ classification: "CONTEXT_TRIGGERED", contextTriggerKey: "event" });
    expect(evaluateContradiction(context, [good, unresolved])).toMatchObject({
      status: "SUFFICIENT", requirementReceipts: [{ terminalStatus: "NOT_REQUIRED", blocking: false }],
    });
    expect(evaluateContradiction(context, [good, unresolved], { activeContextTriggers: ["event"] }))
      .toMatchObject({ status: "INSUFFICIENT", requirementReceipts: [{ terminalStatus: "UNRESOLVED_CONTRADICTION", blocking: true }] });
  });

  it.each([
    { organizationId: "other-org" }, { accountId: "other-account" }, { symbol: "ETH/USDT" },
    { purpose: "OPEN_POSITION_REASSESSMENT" as const }, { venue: "other-venue" },
    { analyticalTimeframe: "5m" }, { horizon: "1h" },
  ])("retains profile non-applicability for %j", (scope) => {
    expect(evaluateContradiction(contradictionProfile(), [good, unresolved], scope))
      .toMatchObject({ requirementReceipts: [{ terminalStatus: "NOT_APPLICABLE", blocking: false,
        acceptedEvidenceIds: [], matchedEvidenceIds: [] }] });
  });

  it.each([
    ["RECORD_ONLY", "UNRESOLVED", "SUFFICIENT"],
    ["REQUIRE_AGREEMENT", "UNRESOLVED", "INSUFFICIENT"],
    ["REQUIRE_AGREEMENT", "CONTRADICTS", "INSUFFICIENT"],
    ["FAIL_UNRESOLVED", "CONTRADICTS", "SUFFICIENT"],
  ] as const)("preserves %s treatment of %s", (contradictionPolicy, contradiction, status) => {
    const profile = contradictionProfile({ contradictionPolicy });
    const receipt = evaluateContradiction(profile, [good, contradictionEvidence("second", contradiction)]);
    expect(receipt.status).toBe(status);
    expect(() => assertInformationSufficiencyReceiptV2(receipt, profile)).not.toThrow();
  });

  it.each([{ evidenceFamily: "unrelated" }, { providerId: "unlisted" }])(
    "ignores unmatched contradictory evidence %j", (changes) => {
      const receipt = evaluateContradiction(contradictionProfile(), [good, { ...unresolved, ...changes }]);
      expect(receipt.status).toBe("SUFFICIENT");
      expect(receipt.requirementReceipts[0]?.matchedEvidenceIds).toEqual(["good"]);
    },
  );

  it.each([
    [{ availableAt: "2026-09-01T11:58:00.000Z" }, "EVIDENCE_STALE"],
    [{ availableAt: "2026-09-01T12:00:01.000Z" }, "EVIDENCE_FUTURE_AT_PIT"],
    [{ pitQualified: false }, "EVIDENCE_NOT_PIT_QUALIFIED"],
    [{ replayEligible: false }, "EVIDENCE_NOT_REPLAY_ELIGIBLE"],
    [{ trust: "UNTRUSTED" }, "EVIDENCE_UNTRUSTED"],
  ] satisfies readonly [Partial<InformationEvidenceV2>, string][])(
    "retains existing hard-floor rejection %j", (changes, reason) => {
      const receipt = evaluateContradiction(contradictionProfile(), [{ ...good, ...changes }]);
      expect(receipt.status).toBe("INSUFFICIENT");
      expect(receipt.reasonCodes).toContain(reason);
    },
  );

  it("retains missing evidence and independence floors", () => {
    expect(evaluateContradiction(contradictionProfile(), []).status).toBe("UNAVAILABLE");
    const profile = contradictionProfile({ minimumIndependentGroups: 2 });
    const receipt = evaluateContradiction(profile, [good, contradictionEvidence("second", "SUPPORTS")]);
    expect(receipt.status).toBe("INSUFFICIENT");
    expect(receipt.requirementReceipts[0]?.effectiveIndependentGroups).toEqual(["source-group"]);
    expect(receipt.reasonCodes).toContain("EFFECTIVE_INDEPENDENT_INFORMATION_BELOW_PROFILE_FLOOR");
  });

  it("cannot compensate a required contradiction with aggregate PASS or extra support", () => {
    const contract = { evaluatorVersion: "test-aggregate-v1", evaluatorContentDigest: sufficiencyHex("aggregate") };
    const profile = contradictionProfile({}, { aggregateQualityContract: contract });
    const aggregateQualityEvaluation = { ...contract, status: "PASS" as const,
      componentReceipts: [], aggregateValueDigest: sufficiencyHex("value"), reasonCodes: [] };
    expect(evaluateContradiction(profile, [good], { aggregateQualityEvaluation }).status).toBe("SUFFICIENT");
    const receipt = evaluateContradiction(profile, [good, unresolved,
      contradictionEvidence("extra", "SUPPORTS", { dependenceGroup: "independent" })], { aggregateQualityEvaluation });
    expect(receipt.status).toBe("INSUFFICIENT");
    expect(receipt.aggregateQualityEvaluation).toBeNull();
  });

  it("preserves canonical order and duplicate-observation independence", () => {
    const profile = contradictionProfile();
    const duplicate = { ...good, evidenceId: "duplicate" };
    const first = evaluateContradiction(profile, [good, duplicate, unresolved]);
    expect(first.status).toBe("INSUFFICIENT");
    expect(evaluateContradiction(profile, [unresolved, duplicate, good])).toEqual(first);
    expect(first.requirementReceipts[0]?.effectiveIndependentGroups).toEqual(["source-group"]);
    expect(() => evaluateContradiction(profile, [good, good])).toThrow("duplicateEvidenceId");
  });

  it("keeps independently sufficient Guardian evidence separate from new-opportunity denial", () => {
    const newOpportunity = evaluateContradiction(contradictionProfile(), [good, unresolved]);
    const guardianProfile = contradictionProfile({}, { purpose: "OPEN_POSITION_REASSESSMENT" });
    const guardian = evaluateContradiction(guardianProfile, [good]);
    expect(newOpportunity.status).toBe("INSUFFICIENT");
    expect(guardian.status).toBe("SUFFICIENT");
    expect(() => assertInformationSufficiencyReceiptV2(guardian, guardianProfile)).not.toThrow();
    expect(admit(bindInformationSufficiencyReceiptAuthorityV2(guardianProfile, guardian)))
      .toMatchObject({ status: "BLOCKED", reasonCode: "PURPOSE_MISMATCH" });
  });

  it("refuses a captured old false-positive receipt on replay without mutating it", () => {
    const profile = beforeFix.profile as RequiredInformationProfileV2;
    const receipt = beforeFix.mixedReceipt as InformationSufficiencyReceiptV2;
    const saved = JSON.stringify(receipt);
    expect(profile).toEqual(contradictionProfile());
    expect(receipt.status).toBe("SUFFICIENT");
    expect(() => assertInformationSufficiencyReceiptV2(receipt, profile)).toThrow("receiptIdentity");
    expect(() => bindInformationSufficiencyReceiptAuthorityV2(profile, receipt)).toThrow("receiptIdentity");
    expect(admit({ schemaVersion: "information-sufficiency-runtime-authority-v2", kind: "PROFILE_RECEIPT",
      organizationId: profile.organizationId, purpose: profile.purpose, profile, receipt,
      authority: "EPISTEMIC_PREREQUISITE_ONLY" })).toMatchObject({ status: "BLOCKED", reasonCode: "INVALID_AUTHORITY" });
    expect(JSON.stringify(receipt)).toBe(saved);
  });

  it("replays an unaffected old positive receipt byte-identically", () => {
    const receipt = beforeFix.goodReceipt as InformationSufficiencyReceiptV2;
    const profile = beforeFix.profile as RequiredInformationProfileV2;
    expect(evaluateContradiction(profile, [good])).toEqual(receipt);
    expect(assertInformationSufficiencyReceiptV2(receipt, profile)).toEqual(receipt);
    expect(admit(bindInformationSufficiencyReceiptAuthorityV2(profile, receipt))).toMatchObject({
      status: "ADMITTED", createsCapitalAuthority: false,
    });
  });

  it("requires exact contradiction lineage before inquiry and never silently stops", async () => {
    const profile = contradictionProfile();
    const receipt = evaluateContradiction(profile, [good, unresolved]);
    const acquire = vi.fn();
    await expect(runInformationInquiryRuntimeV1({
      planningInput: contradictionPlanningInput(profile, receipt, false), mode: "HISTORICAL", acquire,
    })).rejects.toThrow("missingContradictionLineage");
    expect(acquire).not.toHaveBeenCalled();
  });

  it("actual inquiry requests evidence and remains insufficient when the source is unavailable", async () => {
    const profile = contradictionProfile();
    // The existing inquiry materiality contract requires an actual CONTRADICTS
    // observation as well as exact shared-claim lineage; do not invent one.
    const receipt = evaluateContradiction(profile, [good, unresolved,
      contradictionEvidence("counterevidence", "CONTRADICTS")]);
    const planningInput = contradictionPlanningInput(profile, receipt, true);
    const planned = buildInformationNeedPlanningBundleV1(planningInput);
    expect(planned.plan.status).toBe("READY");
    expect(planned.plan.needs[0]?.contradiction?.claimId).toBe("same-price-claim");
    const acquire = vi.fn(async (selection: InformationAcquisitionSelectionV1) => {
      const body = {
        schemaVersion: INFORMATION_ACQUISITION_RECEIPT_V1_SCHEMA_VERSION,
        selectionContentDigest: selection.contentDigest, mode: selection.mode,
        outcomes: selection.requestedSources.map((requestedSource) => ({ requestedSource,
          status: "UNAVAILABLE" as const, reasonCode: "SOURCE_UNAVAILABLE" as const,
          canonicalPitAttempts: [], observationContentDigests: [] })),
        causalObservationContentDigests: [], authority: "EVIDENCE_ACQUISITION_ONLY" as const,
      };
      return { receipt: { ...body, contentDigest: computeInquiryContentDigest(body) },
        finalEvidence: receipt.evidenceInventory,
        attempts: selection.requestedSources.map((source) => ({ iterationIndex: 0, depth: 1,
          needId: source.needId, requirementId: source.requirementId, providerId: source.providerId,
          outcome: "UNAVAILABLE" as const, elapsedMsAtCompletion: 10, evidenceIds: [],
          reasonCodes: ["SOURCE_UNAVAILABLE"] })),
      };
    });
    const result = await runInformationInquiryRuntimeV1({ planningInput, mode: "HISTORICAL", acquire });
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(result.selection.requestedSources).toHaveLength(1);
    expect(result.loopReceipt.finalSufficiencyReceipt.status).toBe("INSUFFICIENT");
    expect(admit(result.informationSufficiencyAuthority)).toMatchObject({ status: "BLOCKED", reasonCode: "INSUFFICIENT" });
    expect(result.createsKnowledgeHypothesisForecastDecisionOrCapitalAuthority).toBe(false);
  });

  it("retains zero acquisition calls for supported-only evidence", async () => {
    const profile = contradictionProfile();
    const receipt = evaluateContradiction(profile, [good]);
    const acquire = vi.fn();
    const result = await runInformationInquiryRuntimeV1({
      planningInput: contradictionPlanningInput(profile, receipt, false), mode: "HISTORICAL", acquire,
    });
    expect(result.planningBundle.plan.status).toBe("NO_ADDITIONAL_EVIDENCE_NEEDED");
    expect(acquire).not.toHaveBeenCalled();
    expect(result.loopReceipt.finalSufficiencyReceipt.status).toBe("SUFFICIENT");
  });
});
