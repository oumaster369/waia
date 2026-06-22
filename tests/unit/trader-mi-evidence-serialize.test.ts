import { describe, expect, it } from "vitest";

import { buildEvidenceContentDigest } from "@/lib/trader/mi/serialize-evidence";

const GOLDEN_ORG_ID = "00000000-0000-4000-8000-00000000e289";

describe("trader mi evidence serialize (DEE-289 / LD-5a.2a)", () => {
  it("content_digest excludes seq and pins reserved null refs", () => {
    const eventTime = new Date("2026-06-22T12:00:00.000Z");
    const ingestTime = new Date("2026-06-22T12:00:01.000Z");
    const baseInput = {
      organizationId: GOLDEN_ORG_ID,
      evidenceKind: "observed" as const,
      direction: "FOR" as const,
      hypothesisKey: "golden-hypothesis-key",
      hypothesisDefinitionDigest: "golden-hypothesis-digest",
      measurementRefs: [
        { measurementKey: "sma20", measurementDefinitionDigest: "fed789" },
      ] as const,
      observationRefs: [{ observationId: "00000000-0000-4000-8000-00000000f289" }] as const,
      eventTime,
      ingestTime,
      recordedBy: "golden-recorder",
      nullComparatorRef: null,
      regimeContextRef: null,
      trialRegistrationRef: null,
    };

    const digestA = buildEvidenceContentDigest(baseInput);
    const digestB = buildEvidenceContentDigest({
      ...baseInput,
      measurementRefs: [{ measurementKey: "sma20", measurementDefinitionDigest: "fed789" }],
      observationRefs: [{ observationId: "00000000-0000-4000-8000-00000000f289" }],
    });

    expect(digestA).toBe(digestB);
    expect(digestA).toBe("99f8a8c364a8b0792c13e3bbf2353d6a6b51076dac1dbef220890ae6507aa99b");
  });

  it("measurement and observation refs are canonically sorted before hashing", () => {
    const eventTime = new Date("2026-06-22T12:00:00.000Z");
    const ingestTime = new Date("2026-06-22T12:00:01.000Z");
    const common = {
      organizationId: GOLDEN_ORG_ID,
      evidenceKind: "observed" as const,
      direction: "AGAINST" as const,
      hypothesisKey: "sort-key",
      hypothesisDefinitionDigest: "sort-digest",
      eventTime,
      ingestTime,
      recordedBy: "sorter",
      nullComparatorRef: null,
      regimeContextRef: null,
      trialRegistrationRef: null,
    };

    const forward = buildEvidenceContentDigest({
      ...common,
      measurementRefs: [
        { measurementKey: "aaa", measurementDefinitionDigest: "111" },
        { measurementKey: "bbb", measurementDefinitionDigest: "222" },
      ],
      observationRefs: [
        { observationId: "00000000-0000-4000-8000-000000000001" },
        { observationId: "00000000-0000-4000-8000-000000000002" },
      ],
    });
    const reverse = buildEvidenceContentDigest({
      ...common,
      measurementRefs: [
        { measurementKey: "bbb", measurementDefinitionDigest: "222" },
        { measurementKey: "aaa", measurementDefinitionDigest: "111" },
      ],
      observationRefs: [
        { observationId: "00000000-0000-4000-8000-000000000002" },
        { observationId: "00000000-0000-4000-8000-000000000001" },
      ],
    });

    expect(forward).toBe(reverse);
  });
});
