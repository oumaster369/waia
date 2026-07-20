import { createHash } from "node:crypto";
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export const HYPOTHESIS_LINK_SCHEMA_VERSION = "waia.trader.hypothesis_link.v1" as const;

export type HypothesisLinkInput = Readonly<{
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  hypothesisType: string;
  evaluatedAt: string;
  thesisDigest: string;
  evidenceDigest: string;
}>;

function deriveDeterministicUuidV4(seed: string): string {
  const hash = createHash("sha256").update(seed, "utf8").digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function deriveAuthoritativeHypothesisLinkDigest(input: HypothesisLinkInput): string {
  const body = {
    schema_version: HYPOTHESIS_LINK_SCHEMA_VERSION,
    organization_id: input.organizationId,
    run_id: input.runId,
    cycle_id: input.cycleId,
    symbol: input.symbol,
    hypothesis_type: input.hypothesisType,
    evaluated_at: input.evaluatedAt,
    thesis_digest: input.thesisDigest,
    evidence_digest: input.evidenceDigest,
  };
  return createHash("sha256").update(canonicalizeSemanticJsonString(body), "utf8").digest("hex");
}

export function deriveHypothesisRecordId(input: HypothesisLinkInput): string {
  const digest = deriveAuthoritativeHypothesisLinkDigest(input);
  return deriveDeterministicUuidV4(
    `waia.trader.hypothesis_record.v1|${input.organizationId}|${input.runId}|${input.cycleId}|${input.symbol}|${input.hypothesisType}|${digest}`,
  );
}
