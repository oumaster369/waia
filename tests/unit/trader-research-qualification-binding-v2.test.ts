import { describe, expect, it } from "vitest";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { buildClosedTradeOutcomeEvidencePackageV2 } from "@/lib/trader/research-v2/closed-trade-outcome-evidence-v2";
import { appendResearchMemoryV2 } from "@/lib/trader/research-v2/research-memory-v2";
import {
  buildResearchQuestionV2,
  buildFalsifiableHypothesisV2,
} from "@/lib/trader/research-v2/research-question-hypothesis-v2";
import { generateStrategyEvolutionCandidateV2 } from "@/lib/trader/research-v2/strategy-candidate-generation-v2";
import {
  recordQualificationV2,
  recordRejectedCandidateV2,
  type QualificationRecordV2,
} from "@/lib/trader/research-v2/qualification-records-v2";
import { buildHumanPromotionProposalV2 } from "@/lib/trader/research-v2/human-promotion-proposal-v2";

function reseal<T extends { contentDigestHex: string }>(value: T): T {
  const { contentDigestHex, ...body } = value;
  void contentDigestHex;
  return { ...value, contentDigestHex: computeSemanticSha256Hex(body) };
}

function fixture() {
  const cutoff = "2026-02-01T11:00:00.000Z";
  const memory = appendResearchMemoryV2(
    buildClosedTradeOutcomeEvidencePackageV2({
      organizationId: "binding-org",
      campaignId: "binding-campaign",
      symbol: "BTCUSDT",
      evidenceCutoffUtc: cutoff,
      outcomes: [
        ["profit", "2"],
        ["loss", "-1"],
      ].map(([id, net]) => ({
        outcomeId: id,
        closedTradeRef: id,
        observedAtUtc: cutoff,
        netEconomicResult: net,
        causalContextDigestHex: "a".repeat(64),
      })),
    }),
  );
  const question = buildResearchQuestionV2({ questionId: "question", memory, symbol: "BTCUSDT" });
  const hypothesis = buildFalsifiableHypothesisV2({
    hypothesisId: "hypothesis",
    question,
    generationKind: "PARAMETER_MUTATION",
  });
  function makeCandidate(version: string) {
    return generateStrategyEvolutionCandidateV2({
      candidateId: `candidate-${version}`,
      strategyId: "binding-research",
      strategyVersion: version,
      kind: "PARAMETER_MUTATION",
      parents: [
        {
          strategyId: "binding-research",
          strategyVersion: "0",
          params: { lookback: "10" },
          artifactDigestHex: "b".repeat(64),
        },
      ],
      params: { lookback: version },
      hypothesis,
      evidenceCutoffUtc: cutoff,
      researchCodeIdentity: "test-only",
      costModelIdentity: "test-only",
    });
  }
  const candidate = makeCandidate("1");
  const otherCandidate = makeCandidate("2");
  const evaluation = {
    netEconomicResult: "1",
    maxDrawdown: "-1",
    tailEventCount: 1,
    sampleSize: 8,
    incumbentComparisonDigestHex: "c".repeat(64),
  };
  const qualificationInput = {
    candidate,
    partition: "DEVELOPMENT" as const,
    evaluation,
    verdict: "QUALIFIED" as const,
  };
  const development = recordQualificationV2(qualificationInput);
  const walkForward = recordQualificationV2({
    ...qualificationInput,
    partition: "WALK_FORWARD",
    evaluation: { ...evaluation, netEconomicResult: "2" },
  });
  const rejected = recordQualificationV2({
    ...qualificationInput,
    verdict: "REJECTED",
    failureReasons: ["FAILED"],
  });
  const input = { proposalId: "proposal", candidate, hypothesis, memory, development, walkForward };
  return { input, qualificationInput, candidate, otherCandidate, rejected, question };
}

describe("DEE-1107 exact research qualification bindings", () => {
  it("keeps a matching proposal deterministic and Human-only, including losses", () => {
    const { input } = fixture();
    const proposal = buildHumanPromotionProposalV2(input);
    expect(buildHumanPromotionProposalV2(input)).toEqual(proposal);
    expect(proposal).toMatchObject({
      disposition: "pending",
      approvalAuthority: "HUMAN_ONLY",
      humanApprovalRequired: true,
      capitalAuthority: "NONE",
      promotionAuthority: "NONE",
      accountAssignmentAuthority: "NONE",
      proposedAccountAssignments: [],
      proposedEligibleSymbols: ["BTCUSDT"],
    });
    expect(proposal.negativeEvidence.map((row) => row.outcomeId)).toEqual(["loss"]);
  });

  it.each(["development", "walkForward", "both"] as const)(
    "rejects foreign-version %s qualifications",
    (slot) => {
      const { input, otherCandidate, qualificationInput } = fixture();
      const development = recordQualificationV2({
        ...qualificationInput,
        candidate: otherCandidate,
      });
      const walkForward = recordQualificationV2({
        ...qualificationInput,
        candidate: otherCandidate,
        partition: "WALK_FORWARD",
      });
      expect(() =>
        buildHumanPromotionProposalV2({
          ...input,
          development: slot !== "walkForward" ? development : input.development,
          walkForward: slot !== "development" ? walkForward : input.walkForward,
        }),
      ).toThrow("QUALIFICATION_CANDIDATE_MISMATCH");
    },
  );

  it.each(["swapped", "reused"])("rejects %s partition records", (mode) => {
    const { input } = fixture();
    expect(() =>
      buildHumanPromotionProposalV2({
        ...input,
        development: mode === "swapped" ? input.walkForward : input.development,
        walkForward: input.development,
      }),
    ).toThrow("QUALIFICATION_PARTITION_MISMATCH");
  });

  const corruptions: [string, (r: QualificationRecordV2) => QualificationRecordV2][] = [
    [
      "stale evaluation digest",
      (r) => ({ ...r, evaluation: { ...r.evaluation, netEconomicResult: "999" } }),
    ],
    ["malformed digest", (r) => ({ ...r, contentDigestHex: "bad" })],
    ["resealed fitting permission", (r) => reseal({ ...r, fittingAllowed: !r.fittingAllowed })],
    ["resealed wrong schema", (r) => reseal({ ...r, schemaVersion: "wrong" as never })],
    ["resealed capital authority", (r) => reseal({ ...r, capitalAuthority: "LIVE" as never })],
    ["resealed qualified with failures", (r) => reseal({ ...r, failureReasons: ["FAILED"] })],
    ["resealed unknown verdict", (r) => reseal({ ...r, verdict: "UNKNOWN" as never })],
    [
      "resealed invalid evaluation",
      (r) => reseal({ ...r, evaluation: { ...r.evaluation, sampleSize: 0 } }),
    ],
  ];
  it.each(corruptions)("rejects %s in a proposal", (_name, corrupt) => {
    const { input } = fixture();
    expect(() =>
      buildHumanPromotionProposalV2({ ...input, development: corrupt(input.development) }),
    ).toThrow();
  });
  it.each(corruptions)("rejects %s in a rejected-candidate record", (_name, corrupt) => {
    const { input, rejected } = fixture();
    expect(() =>
      recordRejectedCandidateV2({
        ...input,
        development: rejected,
        walkForward: corrupt(input.walkForward),
      }),
    ).toThrow();
  });

  it("rejects an unrelated but correctly sealed hypothesis", () => {
    const { input } = fixture();
    const hypothesis = buildFalsifiableHypothesisV2({
      hypothesisId: "another",
      question: buildResearchQuestionV2({
        questionId: "other",
        memory: input.memory,
        symbol: "ETHUSDT",
      }),
      generationKind: "PARAMETER_MUTATION",
    });
    expect(() => buildHumanPromotionProposalV2({ ...input, hypothesis })).toThrow(
      "PROMOTION_HYPOTHESIS_MISMATCH",
    );
  });
  it("rejects changed hypothesis content under the original digest", () => {
    const { input } = fixture();
    expect(() =>
      buildHumanPromotionProposalV2({
        ...input,
        hypothesis: { ...input.hypothesis, intendedSymbol: "ETHUSDT" },
      }),
    ).toThrow("PROMOTION_HYPOTHESIS_INVALID");
  });
  it.each(["proposal", "qualification", "rejection"] as const)(
    "rejects stale candidate content at %s boundary",
    (boundary) => {
      const { input, qualificationInput, rejected } = fixture();
      const candidate = { ...input.candidate, strategyVersion: "unqualified-new-version" };
      const call =
        boundary === "proposal"
          ? () => buildHumanPromotionProposalV2({ ...input, candidate })
          : boundary === "qualification"
            ? () => recordQualificationV2({ ...qualificationInput, candidate })
            : () => recordRejectedCandidateV2({ ...input, candidate, development: rejected });
      expect(call).toThrow("QUALIFICATION_CANDIDATE_INVALID");
    },
  );
  it.each([
    "capitalAuthority",
    "accountAssignmentAuthority",
    "venueWriteAuthority",
    "promotionAuthority",
  ] as const)("rejects resealed candidate %s escalation", (field) => {
    const { qualificationInput } = fixture();
    const candidate = reseal({ ...qualificationInput.candidate, [field]: "LIVE" });
    expect(() => recordQualificationV2({ ...qualificationInput, candidate })).toThrow(
      "QUALIFICATION_CANDIDATE_INVALID",
    );
  });

  it.each(["UNKNOWN", "", null, undefined])(
    "rejects unknown verdict %s before qualification",
    (verdict) => {
      const { qualificationInput } = fixture();
      expect(() =>
        recordQualificationV2({ ...qualificationInput, verdict: verdict as never }),
      ).toThrow("QUALIFICATION_VERDICT_INVALID");
    },
  );
  it.each(["UNKNOWN", "", null, undefined])(
    "rejects unknown partition %s before qualification",
    (partition) => {
      const { qualificationInput } = fixture();
      expect(() =>
        recordQualificationV2({ ...qualificationInput, partition: partition as never }),
      ).toThrow("QUALIFICATION_PARTITION_INVALID");
    },
  );
  it("preserves explicit failure rejection and the blind-holdout prohibition", () => {
    const { qualificationInput } = fixture();
    expect(
      recordQualificationV2({ ...qualificationInput, failureReasons: ["FAILED"] }).verdict,
    ).toBe("REJECTED");
    expect(() =>
      recordQualificationV2({ ...qualificationInput, partition: "BLIND_HOLDOUT" }),
    ).toThrow("BLIND_HOLDOUT_ITERATIVE_FITNESS_FORBIDDEN");
  });
  it("retains a matching rejection and refuses a foreign candidate or swapped slots", () => {
    const { input, rejected, otherCandidate } = fixture();
    expect(recordRejectedCandidateV2({ ...input, development: rejected })).toMatchObject({
      status: "REJECTED",
      candidateDigestHex: input.candidate.contentDigestHex,
    });
    expect(() =>
      recordRejectedCandidateV2({ ...input, candidate: otherCandidate, development: rejected }),
    ).toThrow("QUALIFICATION_CANDIDATE_MISMATCH");
    expect(() =>
      recordRejectedCandidateV2({
        ...input,
        development: input.walkForward,
        walkForward: rejected,
      }),
    ).toThrow("QUALIFICATION_PARTITION_MISMATCH");
  });
});
