import { createHash } from "node:crypto";

import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export const OPENING_CAUSAL_LINEAGE_SCHEMA_VERSION =
  "waia.trader.opening_causal_lineage.v1" as const;

export type OpeningCausalLineageV1 = Readonly<{
  schemaVersion: typeof OPENING_CAUSAL_LINEAGE_SCHEMA_VERSION;
  organizationId: string;
  symbol: string;
  canonicalCausalLineageDigest: string;
  forecastId: string;
  forecastContentDigest: string;
  decisionId: string;
  decisionContentDigest: string;
  riskVerdictId: string;
  riskAllowanceId: string;
  riskAllowanceContentDigest: string;
  contentDigest: string;
}>;

export type OpeningCausalLineageV1Draft = Omit<
  OpeningCausalLineageV1,
  "schemaVersion" | "contentDigest"
>;

const DIGEST = /^[0-9a-f]{64}$/;
const KEYS = [
  "canonicalCausalLineageDigest", "contentDigest", "decisionContentDigest", "decisionId",
  "forecastContentDigest", "forecastId", "organizationId", "riskAllowanceContentDigest",
  "riskAllowanceId", "riskVerdictId", "schemaVersion", "symbol",
].sort();

function bodyDigest(body: OpeningCausalLineageV1Draft & { schemaVersion: string }): string {
  return createHash("sha256")
    .update(canonicalizeSemanticJsonString(body), "utf8")
    .digest("hex");
}

export function assertOpeningCausalLineageV1(value: OpeningCausalLineageV1): void {
  if (value.schemaVersion !== OPENING_CAUSAL_LINEAGE_SCHEMA_VERSION) {
    throw new Error("OPENING_CAUSAL_LINEAGE_UNSUPPORTED_VERSION");
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(KEYS)) {
    throw new Error("OPENING_CAUSAL_LINEAGE_UNEXPECTED_FIELD");
  }
  for (const field of ["organizationId", "symbol", "forecastId", "decisionId", "riskVerdictId", "riskAllowanceId"] as const) {
    if (!value[field]) throw new Error("OPENING_CAUSAL_LINEAGE_INCOMPLETE");
  }
  for (const field of ["canonicalCausalLineageDigest", "forecastContentDigest", "decisionContentDigest", "riskAllowanceContentDigest", "contentDigest"] as const) {
    if (!DIGEST.test(value[field])) throw new Error("OPENING_CAUSAL_LINEAGE_INVALID_DIGEST");
  }
  const { contentDigest, ...body } = value;
  if (bodyDigest(body) !== contentDigest) throw new Error("OPENING_CAUSAL_LINEAGE_DIGEST_MISMATCH");
}

export function buildOpeningCausalLineageV1(draft: OpeningCausalLineageV1Draft): OpeningCausalLineageV1 {
  const body = { schemaVersion: OPENING_CAUSAL_LINEAGE_SCHEMA_VERSION, ...draft };
  const value = Object.freeze({ ...body, contentDigest: bodyDigest(body) });
  assertOpeningCausalLineageV1(value);
  return value;
}

export function serializeOpeningCausalLineageV1(value: OpeningCausalLineageV1): string {
  assertOpeningCausalLineageV1(value);
  return canonicalizeSemanticJsonString(value);
}

export function parseOpeningCausalLineageV1(json: string): OpeningCausalLineageV1 {
  let value: OpeningCausalLineageV1;
  try { value = JSON.parse(json) as OpeningCausalLineageV1; }
  catch { throw new Error("OPENING_CAUSAL_LINEAGE_INVALID_JSON"); }
  assertOpeningCausalLineageV1(value);
  if (serializeOpeningCausalLineageV1(value) !== json) throw new Error("OPENING_CAUSAL_LINEAGE_NON_CANONICAL_JSON");
  return value;
}
