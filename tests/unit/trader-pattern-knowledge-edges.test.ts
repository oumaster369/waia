import { describe, expect, it } from "vitest";

import {
  buildCloseKnowledgeToRef,
  buildPatternKnowledgeFromRef,
  buildRejectionKnowledgeToRef,
  patternKnowledgeRelationKinds,
} from "@/lib/trader/knowledge/pattern-knowledge-relation-kinds";

describe("pattern knowledge edges (M6)", () => {
  it("uses observational relation kinds only", () => {
    expect(patternKnowledgeRelationKinds.patternAssociatedWithClose).toBe(
      "pattern_associated_with_close",
    );
    expect(patternKnowledgeRelationKinds.patternAssociatedWithRejection).toBe(
      "pattern_associated_with_rejection",
    );
  });

  it("builds stable edge refs", () => {
    expect(
      buildPatternKnowledgeFromRef({
        patternKey: "org:recurring_structure:spike",
        definitionDigest: "abc123",
      }),
    ).toBe("pattern:org:recurring_structure:spike@abc123");
    expect(buildCloseKnowledgeToRef({ orderId: "order-1" })).toBe("close:order:order-1");
    expect(buildRejectionKnowledgeToRef({ strategySignalId: "sig-1" })).toBe(
      "signal:sig-1:rejected",
    );
  });
});
