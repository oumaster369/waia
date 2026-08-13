import { describe, expect, it } from "vitest";

import {
  assertKnowledgeCheckpointRoundtrip,
  computeKnowledgeSemanticDigest,
} from "@/lib/trader/intelligence/knowledge-state/knowledge-state-checkpoint-v2";

describe("DEE-534 knowledge state checkpoint v2", () => {
  it("roundtrip restores identical knowledge digest", () => {
    const checkpoint = {
      organizationId: "00000000-0000-4000-8000-000000000001",
      checkpointSeq: 1,
      modelVersion: "rv-state-conditional-empirical-joint/v1",
      calibrationSnapshotDigest: "a".repeat(64),
      rejectedResearchStates: ["trial-reject-1"],
      promotedResearchStates: ["trial-promote-1"],
      forecastPackageGenerationDigest: "b".repeat(64),
    };
    const digest = computeKnowledgeSemanticDigest(checkpoint);
    assertKnowledgeCheckpointRoundtrip(checkpoint, { ...checkpoint });
    expect(digest).toHaveLength(64);
  });
});
