import { describe, expect, it } from "vitest";

import {
  KNOWLEDGE_AUTHORITY_REASON,
  KnowledgeAuthorityError,
} from "@/lib/trader/knowledge/knowledge-edge-version-v2";
import {
  deleteKnowledgeEdgePostgres,
  updateKnowledgeEdgePostgres,
} from "@/lib/trader/knowledge/knowledge-edge-repository-postgres";
import { legacyMkbHeuristicMutationDisabled } from "@/lib/trader/knowledge/legacy-mkb-mutation";
import {
  adjustEdgeConfidenceFromVerification,
  applyLegacyMkbHeuristicConfidenceAdjustment,
  updateEdgeConfidenceFromVerification,
} from "@/lib/trader/knowledge/market-memory";

const context = { organizationId: "00000000-0000-4000-8000-000000000001" };

describe("DEE-771 legacy MKB quarantine", () => {
  it("keeps the named production guard closed", () => {
    expect(legacyMkbHeuristicMutationDisabled()).toBe(true);
  });

  it("refuses adjustEdgeConfidenceFromVerification on the production path", () => {
    try {
      adjustEdgeConfidenceFromVerification("0.7000", "confirmed");
      throw new Error("expected refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeAuthorityError);
      expect((error as KnowledgeAuthorityError).code).toBe(
        KNOWLEDGE_AUTHORITY_REASON.LEGACY_MKB_MUTATION_DISABLED,
      );
    }
  });

  it("preserves the historical arithmetic shape behind the guard", () => {
    expect(applyLegacyMkbHeuristicConfidenceAdjustment("0.7000", "confirmed")).toEqual({
      confidence: "0.7300",
      verified: true,
    });
    expect(applyLegacyMkbHeuristicConfidenceAdjustment("0.8000", "rejected").confidence).toBe(
      "0.6800",
    );
    expect(applyLegacyMkbHeuristicConfidenceAdjustment("0.8000", "inconclusive").confidence).toBe(
      "0.7600",
    );
  });

  it("refuses updateEdgeConfidenceFromVerification", async () => {
    await expect(
      updateEdgeConfidenceFromVerification({} as never, context, {
        edgeId: "edge",
        verificationResult: "confirmed",
      }),
    ).rejects.toMatchObject({ code: KNOWLEDGE_AUTHORITY_REASON.LEGACY_MKB_MUTATION_DISABLED });
  });

  it("cannot delete Knowledge history", async () => {
    await expect(deleteKnowledgeEdgePostgres({} as never, context, "edge")).rejects.toMatchObject({
      code: KNOWLEDGE_AUTHORITY_REASON.LEGACY_KNOWLEDGE_DELETE_DISABLED,
    });
  });

  it("cannot in-place update Knowledge edges", async () => {
    await expect(
      updateKnowledgeEdgePostgres({} as never, context, "edge", {
        confidence: "0.9",
        updatedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: KNOWLEDGE_AUTHORITY_REASON.LEGACY_MKB_MUTATION_DISABLED });
  });
});
