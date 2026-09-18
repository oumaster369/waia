import { createHash } from "node:crypto";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  KNOWLEDGE_AUTHORITY_REASON,
  KnowledgeAuthorityError,
} from "@/lib/trader/knowledge/knowledge-edge-version-v2";
import type { MarketPredictionVerificationResult } from "@/lib/trader/knowledge/knowledge.types";

export const MARKET_PREDICTION_VERIFICATION_SCHEMA_V2 =
  "market-prediction-verification/v2" as const;

const RECEIPT_HEX = /^[0-9a-f]{64}$/;

export type MarketPredictionVerificationContentV2 = Readonly<{
  outcomeJson: string;
  verificationResult: MarketPredictionVerificationResult;
}>;

export function computeMarketPredictionVerificationDigestHex(
  content: MarketPredictionVerificationContentV2,
): string {
  return computeSemanticSha256Hex({
    outcomeJson: content.outcomeJson,
    verificationResult: content.verificationResult,
  });
}

export function marketPredictionVerificationRowId(seed: string): string {
  const hash = createHash("sha256").update(seed, "utf8").digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function requireProducingReceiptDigest(digest: string): string {
  if (!RECEIPT_HEX.test(digest)) {
    throw new KnowledgeAuthorityError(KNOWLEDGE_AUTHORITY_REASON.PRODUCING_RECEIPT_UNRESOLVABLE);
  }
  return digest;
}
