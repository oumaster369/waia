import { describe, expect, it } from "vitest";

import {
  deriveConfidenceEligibility,
  deriveConfidenceSignals,
  deriveHypothesisLifecycleStateAsOf,
  MI_CONFIDENCE_DERIVATION_VERSION,
  selectLatestConfidenceJudgmentForVersion,
  signalsMustNotGateEligibility,
  type MiConfidenceJudgment,
} from "@/lib/trader/mi/confidence-judgment.types";

function buildJudgment(
  overrides: Partial<MiConfidenceJudgment> & Pick<MiConfidenceJudgment, "seq" | "ingestTime">,
): MiConfidenceJudgment {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    organizationId: overrides.organizationId ?? "org",
    hypothesisId: overrides.hypothesisId ?? "hyp-1",
    hypothesisKey: overrides.hypothesisKey ?? "key-1",
    hypothesisDefinitionDigest: overrides.hypothesisDefinitionDigest ?? "digest-1",
    level: overrides.level ?? "supported",
    bandLow: overrides.bandLow ?? "tentative",
    bandHigh: overrides.bandHigh ?? "strong",
    confidenceScaleVersion: overrides.confidenceScaleVersion ?? "mi-confidence-scale-v1",
    judgmentKind: overrides.judgmentKind ?? "asserted",
    reviewHorizonAt: overrides.reviewHorizonAt ?? new Date("2026-07-01T00:00:00.000Z"),
    forCitations: overrides.forCitations ?? [],
    eventTime: overrides.eventTime ?? overrides.ingestTime,
    ingestTime: overrides.ingestTime,
    recordedBy: overrides.recordedBy ?? "operator",
    seq: overrides.seq,
    contentDigest: overrides.contentDigest ?? "digest",
    schemaVersion: "mi-confidence-judgment-v1",
    createdAt: overrides.createdAt ?? overrides.ingestTime,
  };
}

describe("trader mi confidence judgment fold (DEE-293 / LD-5a.3a)", () => {
  const asOf = new Date("2026-06-23T12:00:00.000Z");

  it("selectLatestConfidenceJudgmentForVersion uses ingest_time visibility, not event_time", () => {
    const backdated = buildJudgment({
      seq: 1,
      ingestTime: new Date("2026-06-23T13:00:00.000Z"),
      eventTime: new Date("2026-06-22T10:00:00.000Z"),
    });
    const earlierVisible = buildJudgment({
      seq: 2,
      ingestTime: new Date("2026-06-23T11:00:00.000Z"),
    });

    expect(
      selectLatestConfidenceJudgmentForVersion(
        [backdated, earlierVisible],
        backdated.hypothesisId,
        asOf,
      ),
    ).toEqual(earlierVisible);
  });

  it("WITHDRAWN is distinct from NO_JUDGMENT", () => {
    const withdrawn = buildJudgment({
      seq: 1,
      ingestTime: new Date("2026-06-23T10:00:00.000Z"),
      judgmentKind: "insufficiency_attested",
      level: null,
      bandLow: null,
      bandHigh: null,
      confidenceScaleVersion: null,
      reviewHorizonAt: null,
    });

    const noJudgment = deriveConfidenceEligibility({
      hypothesisId: "hyp-1",
      asOf,
      latestJudgment: null,
      lifecycleState: "VALIDATED",
      citationIntegrityInvalidated: false,
    });
    const withdrawnResult = deriveConfidenceEligibility({
      hypothesisId: "hyp-1",
      asOf,
      latestJudgment: withdrawn,
      lifecycleState: "VALIDATED",
      citationIntegrityInvalidated: false,
    });

    expect(noJudgment.reasons).toEqual(["NO_JUDGMENT"]);
    expect(withdrawnResult.reasons).toEqual(["WITHDRAWN"]);
  });

  it("returns full co-occurring reason set", () => {
    const expiredWithdrawn = buildJudgment({
      seq: 1,
      ingestTime: new Date("2026-06-23T10:00:00.000Z"),
      judgmentKind: "insufficiency_attested",
      level: null,
      bandLow: null,
      bandHigh: null,
      confidenceScaleVersion: null,
      reviewHorizonAt: new Date("2026-06-22T00:00:00.000Z"),
    });

    const result = deriveConfidenceEligibility({
      hypothesisId: "hyp-1",
      asOf,
      latestJudgment: expiredWithdrawn,
      lifecycleState: "RETIRED",
      citationIntegrityInvalidated: true,
    });

    expect(result.verdict).toBe("INELIGIBLE");
    expect(result.reasons).toEqual([
      "WITHDRAWN",
      "EXPIRED",
      "CITATION_INVALIDATED",
      "LIFECYCLE_BLOCKED",
    ]);
    expect(result.derivationVersionId).toBe(MI_CONFIDENCE_DERIVATION_VERSION);
  });

  it("signals never gate eligibility", () => {
    const eligibility = deriveConfidenceEligibility({
      hypothesisId: "hyp-1",
      asOf,
      latestJudgment: buildJudgment({
        seq: 1,
        ingestTime: new Date("2026-06-23T10:00:00.000Z"),
      }),
      lifecycleState: "VALIDATED",
      citationIntegrityInvalidated: false,
    });
    const signals = deriveConfidenceSignals({
      hypothesisId: "hyp-1",
      hypothesisKey: "key-1",
      asOf,
      latestJudgment: buildJudgment({
        seq: 1,
        ingestTime: new Date("2026-06-23T10:00:00.000Z"),
      }),
      hasNewDisconfirmingEvidence: true,
      hasNewCorroboratingEvidence: true,
      hasNewerHypothesisVersion: true,
      expiringSoon: true,
    });

    expect(eligibility.verdict).toBe("ELIGIBLE");
    expect(signals.signals).toHaveLength(4);
    expect(signalsMustNotGateEligibility(eligibility, signals)).toBe(true);
  });

  it("deriveHypothesisLifecycleStateAsOf filters by created_at", () => {
    const state = deriveHypothesisLifecycleStateAsOf(
      [
        {
          id: "1",
          organizationId: "org",
          hypothesisId: "hyp-1",
          hypothesisKey: "key-1",
          lifecycleState: "VALIDATING",
          rationale: "sealed",
          recordedBy: "operator",
          seq: 1,
          contentDigest: "d1",
          createdAt: new Date("2026-06-20T00:00:00.000Z"),
        },
        {
          id: "2",
          organizationId: "org",
          hypothesisId: "hyp-1",
          hypothesisKey: "key-1",
          lifecycleState: "RETIRED",
          rationale: "retired",
          recordedBy: "operator",
          seq: 2,
          contentDigest: "d2",
          createdAt: new Date("2026-06-25T00:00:00.000Z"),
        },
      ],
      asOf,
    );
    expect(state).toBe("VALIDATING");
  });
});
