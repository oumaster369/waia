import { describe, expect, it } from "vitest";

import {
  buildConfidenceJudgmentContentDigest,
  canonicalizeConfidenceJudgmentContentDigestInput,
} from "@/lib/trader/mi/serialize-confidence-judgment";

const GOLDEN_ORG_ID = "00000000-0000-4000-8000-00000000e293";

const GOLDEN_ASSERTED_DIGEST = "63f761fbf7f49e93d4e5f8e86ae9039cbfabb0ffdfd26f59102daaed1a7d097b";

describe("trader mi confidence judgment serialize (DEE-293 / LD-5a.3a)", () => {
  const eventTime = new Date("2026-06-23T10:00:00.000Z");
  const ingestTime = new Date("2026-06-23T10:00:01.000Z");
  const reviewHorizonAt = new Date("2026-07-23T10:00:00.000Z");

  const baseAssertedInput = {
    organizationId: GOLDEN_ORG_ID,
    hypothesisKey: "00000000-0000-4000-8000-00000000f293",
    hypothesisDefinitionDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    confidenceScaleVersion: "mi-confidence-scale-v1" as const,
    level: "supported" as const,
    bandLow: "tentative" as const,
    bandHigh: "strong" as const,
    judgmentKind: "asserted" as const,
    reviewHorizonAt,
    forCitations: [
      {
        evidenceId: "00000000-0000-4000-8000-00000000a293",
        evidenceContentDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    ],
    eventTime,
    ingestTime,
    recordedBy: "golden-recorder",
  };

  it("content_digest is deterministic and excludes seq and derived state", () => {
    const digestA = buildConfidenceJudgmentContentDigest(baseAssertedInput);
    const digestB = buildConfidenceJudgmentContentDigest({ ...baseAssertedInput });

    expect(digestA).toBe(digestB);
    expect(digestA).toBe(GOLDEN_ASSERTED_DIGEST);
  });

  it("canonical digest input binds the frozen F17 field set", () => {
    expect(canonicalizeConfidenceJudgmentContentDigestInput(baseAssertedInput)).toEqual({
      bandHigh: "strong",
      bandLow: "tentative",
      confidenceScaleVersion: "mi-confidence-scale-v1",
      eventTime: "2026-06-23T10:00:00.000Z",
      forCitations: [
        {
          evidenceContentDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          evidenceId: "00000000-0000-4000-8000-00000000a293",
        },
      ],
      hypothesisDefinitionDigest:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      hypothesisKey: "00000000-0000-4000-8000-00000000f293",
      ingestTime: "2026-06-23T10:00:01.000Z",
      judgmentKind: "asserted",
      level: "supported",
      organizationId: GOLDEN_ORG_ID,
      recordedBy: "golden-recorder",
      reviewHorizonAt: "2026-07-23T10:00:00.000Z",
      schemaVersion: "mi-confidence-judgment-v1",
    });
  });

  it("withdrawal digest uses null scale fields", () => {
    const withdrawalDigest = buildConfidenceJudgmentContentDigest({
      organizationId: GOLDEN_ORG_ID,
      hypothesisKey: "00000000-0000-4000-8000-00000000f293",
      hypothesisDefinitionDigest:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      confidenceScaleVersion: null,
      level: null,
      bandLow: null,
      bandHigh: null,
      judgmentKind: "insufficiency_attested",
      reviewHorizonAt: null,
      forCitations: [],
      eventTime,
      ingestTime,
      recordedBy: "golden-recorder",
    });
    expect(withdrawalDigest).not.toBe(buildConfidenceJudgmentContentDigest(baseAssertedInput));
  });

  it("forCitations sort order is stable in digest", () => {
    const unsorted = buildConfidenceJudgmentContentDigest({
      ...baseAssertedInput,
      forCitations: [
        {
          evidenceId: "00000000-0000-4000-8000-00000000z293",
          evidenceContentDigest: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        },
        {
          evidenceId: "00000000-0000-4000-8000-00000000a293",
          evidenceContentDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      ],
    });
    const sorted = buildConfidenceJudgmentContentDigest({
      ...baseAssertedInput,
      forCitations: [
        {
          evidenceId: "00000000-0000-4000-8000-00000000a293",
          evidenceContentDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        {
          evidenceId: "00000000-0000-4000-8000-00000000z293",
          evidenceContentDigest: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        },
      ],
    });
    expect(unsorted).toBe(sorted);
  });
});
