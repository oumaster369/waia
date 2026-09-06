import { createHash } from "node:crypto";

import {
  canonicalizeSemanticJsonString,
  canonicalizeSemanticObject,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { SourceAnchor } from
  "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";

/** Compare the same canonical JSON, one anchor at a time (no corpus-sized string). */
export function canonicalSourceCorporaEqualV2(
  left: readonly SourceAnchor[],
  right: readonly SourceAnchor[],
): boolean {
  return left.length === right.length && left.every((anchor, index) =>
    canonicalizeSemanticJsonString(anchor) === canonicalizeSemanticJsonString(right[index]));
}

/** Exact legacy envelope bytes; only a single serialized anchor is retained at a time. */
export function computeKmDevelopmentCorpusDigestV2(input: Readonly<{
  schemaVersion: "km-development-corpus/v2";
  organizationId: string;
  datasetAuthorityIdentityDigestHex: string;
  surface: Readonly<{ symbol: "BTCUSDT" | "ETHUSDT"; primaryHorizonMinutes: 30 | 60 }>;
  corpus: readonly SourceAnchor[];
}>): string {
  const hash = createHash("sha256");
  // Reuse canonical key enumeration, including JSON's integer-key ordering. The
  // placeholder prevents canonicalization from duplicating the complete corpus.
  const envelope = canonicalizeSemanticObject({ ...input, corpus: [] });
  hash.update("{");
  for (const [index, key] of Object.keys(envelope).entries()) {
    if (index > 0) hash.update(",");
    hash.update(JSON.stringify(key));
    hash.update(":");
    if (key === "corpus") {
      hash.update("[");
      for (let i = 0; i < input.corpus.length; i += 1) {
        if (i > 0) hash.update(",");
        hash.update(canonicalizeSemanticJsonString(input.corpus[i]), "utf8");
      }
      hash.update("]");
    } else {
      hash.update(canonicalizeSemanticJsonString(envelope[key as keyof typeof envelope]), "utf8");
    }
  }
  return hash.update("}").digest("hex");
}
