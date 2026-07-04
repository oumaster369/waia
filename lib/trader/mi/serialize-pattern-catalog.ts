import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import type { PatternCatalogExplanationPayload } from "@/lib/trader/mi/pattern-catalog.types";

export type PatternScoreContentDigestInput = {
  organizationId: string;
  patternKey: string;
  definitionDigest: string;
  subjectRef: string;
  evaluatedAt: string;
  matchScore: string;
  relevanceScore: string;
  confidenceMean: string;
};

export type PriceMoveExplanationContentDigestInput = {
  organizationId: string;
  subjectRef: string;
  payload: PatternCatalogExplanationPayload;
};

export function buildPatternScoreContentDigest(input: PatternScoreContentDigestInput): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        organizationId: input.organizationId,
        patternKey: input.patternKey,
        definitionDigest: input.definitionDigest,
        subjectRef: input.subjectRef,
        evaluatedAt: input.evaluatedAt,
        matchScore: input.matchScore,
        relevanceScore: input.relevanceScore,
        confidenceMean: input.confidenceMean,
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildPriceMoveExplanationContentDigest(
  input: PriceMoveExplanationContentDigestInput,
): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        organizationId: input.organizationId,
        subjectRef: input.subjectRef,
        payload: input.payload,
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildPatternCatalogIdempotencyKey(input: {
  organizationId: string;
  patternKey: string;
  definitionDigest: string;
  subjectRef: string;
}): string {
  return createHash("sha256")
    .update(
      `${input.organizationId}:${input.patternKey}:${input.definitionDigest}:${input.subjectRef}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 32);
}
