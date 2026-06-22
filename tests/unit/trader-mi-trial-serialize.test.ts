import { describe, expect, it } from "vitest";

import { buildTrialContentDigest } from "@/lib/trader/mi/serialize-trial";

const GOLDEN_ORG_ID = "00000000-0000-4000-8000-00000000e290";

describe("trader mi trial serialize (DEE-289 / LD-5a.2b)", () => {
  const eventTime = new Date("2026-06-22T12:00:00.000Z");
  const ingestTime = new Date("2026-06-22T12:00:01.000Z");
  const baseInput = {
    organizationId: GOLDEN_ORG_ID,
    hypothesisKey: "golden-hypothesis-key",
    hypothesisId: "00000000-0000-4000-8000-00000000f290",
    hypothesisDefinitionDigest: "golden-hypothesis-digest",
    researchProgram: null,
    eventTime,
    ingestTime,
    registeredBy: "golden-registrar",
  };

  it("content_digest is deterministic and pins only the hypothesis (no seq, no snapshot)", () => {
    const digestA = buildTrialContentDigest(baseInput);
    const digestB = buildTrialContentDigest({ ...baseInput });

    expect(digestA).toBe(digestB);
    expect(digestA).toBe("0da15e03d5fc71e8479856d7f8d35b81b50ac0a70e687e63ab18b196aaf357c4");
  });

  it("research_program participates in the digest", () => {
    const withProgram = buildTrialContentDigest({ ...baseInput, researchProgram: "alpha-program" });
    expect(withProgram).not.toBe(buildTrialContentDigest(baseInput));
  });

  it("hypothesis definition digest participates in the digest", () => {
    const rebound = buildTrialContentDigest({
      ...baseInput,
      hypothesisDefinitionDigest: "other-digest",
    });
    expect(rebound).not.toBe(buildTrialContentDigest(baseInput));
  });
});
