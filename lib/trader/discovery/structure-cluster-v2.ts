import {
  STRUCTURE_CLUSTER_V2_SCHEMA_VERSION,
  type StructureClusterV2,
  type TradeReferenceCountBand,
} from "@/lib/trader/discovery/structure.types";
import type { ResearchCampaignRef } from "@/lib/trader/discovery/discovery.types";
import { buildStructureClusterV2ContentDigest } from "@/lib/trader/discovery/serialize-discovery";

function invalid(reason: string): never {
  throw new Error(`STRUCTURE_CLUSTER_V2_INVALID:${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort((a, b) => a.localeCompare(b));
  const expected = [...keys].sort((a, b) => a.localeCompare(b));
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function assertValidResearchCampaignRefV2(value: unknown): asserts value is ResearchCampaignRef {
  if (!isRecord(value) || !hasExactKeys(value, ["campaignId", "campaignDigest", "state"]) ||
      typeof value.campaignId !== "string" || value.campaignId.length === 0 ||
      typeof value.campaignDigest !== "string" || value.campaignDigest.length === 0 ||
      (value.state !== "PROPOSED" && value.state !== "ACTIVE" && value.state !== "PAUSED" &&
       value.state !== "CONSOLIDATING" && value.state !== "CONSOLIDATED" && value.state !== "ARCHIVED")) {
    invalid("CAMPAIGN_REF");
  }
}

export function tradeReferenceCountBandForCount(count: number): TradeReferenceCountBand {
  if (!Number.isSafeInteger(count) || count < 0) {
    return invalid("TRADE_REFERENCE_COUNT");
  }
  if (count <= 1) return "low";
  if (count <= 5) return "medium";
  return "high";
}

export function structureSignatureKeyV2(
  regimeLabel: string,
  band: TradeReferenceCountBand,
): string {
  return `v2::${regimeLabel}::trade-reference-count-band::${band}`;
}

/** Validates the complete self-contained V2 shape. Its digest proves integrity, not provenance. */
export function assertValidStructureClusterV2(value: unknown): asserts value is StructureClusterV2 {
  if (!isRecord(value) || !hasExactKeys(value, [
    "schemaVersion",
    "clusterId",
    "campaignRef",
    "signature",
    "memberObservationRefs",
    "memberTradeReferenceCounts",
    "contentDigest",
    "createdAt",
  ])) {
    invalid("SHAPE");
  }
  if (value.schemaVersion !== STRUCTURE_CLUSTER_V2_SCHEMA_VERSION) invalid("SCHEMA_VERSION");
  if (typeof value.clusterId !== "string" || value.clusterId.length === 0 ||
      typeof value.createdAt !== "string" || value.createdAt.length === 0) {
    invalid("IDENTITY");
  }

  assertValidResearchCampaignRefV2(value.campaignRef);

  const signature = value.signature;
  if (!isRecord(signature) || !hasExactKeys(signature, [
    "signatureKey",
    "regimeLabel",
    "metricKind",
    "tradeReferenceCountBand",
    "measuredVolatilityStatus",
    "tradeCount",
    "observationCount",
  ])) {
    invalid("SIGNATURE_SHAPE");
  }
  const regimeLabel = signature.regimeLabel;
  const band = signature.tradeReferenceCountBand;
  if (typeof regimeLabel !== "string" || regimeLabel.length === 0 ||
      signature.metricKind !== "TRADE_REFERENCE_COUNT_BAND" ||
      (band !== "low" && band !== "medium" && band !== "high") ||
      signature.measuredVolatilityStatus !== "UNAVAILABLE") {
    invalid("METRIC");
  }
  if (signature.signatureKey !== structureSignatureKeyV2(regimeLabel, band)) {
    invalid("SIGNATURE_KEY");
  }

  const refs = value.memberObservationRefs;
  const memberCounts = value.memberTradeReferenceCounts;
  if (!Array.isArray(refs) || refs.length === 0 ||
      refs.some((ref) => typeof ref !== "string" || ref.length === 0) ||
      refs.some((ref, index) => index > 0 && refs[index - 1]! >= ref)) {
    invalid("MEMBER_REFS");
  }
  if (!Array.isArray(memberCounts) || memberCounts.length !== refs.length) {
    invalid("MEMBER_COUNTS");
  }

  let totalTradeCount = 0;
  for (const [index, member] of memberCounts.entries()) {
    if (!isRecord(member) || !hasExactKeys(member, ["observationRef", "tradeReferenceCount"]) ||
        member.observationRef !== refs[index] || !Number.isSafeInteger(member.tradeReferenceCount) ||
        (member.tradeReferenceCount as number) < 0) {
      invalid(`MEMBER_COUNT:${index}`);
    }
    const count = member.tradeReferenceCount as number;
    if (tradeReferenceCountBandForCount(count) !== band) invalid(`MEMBER_BAND:${index}`);
    totalTradeCount += count;
  }
  if (!Number.isSafeInteger(signature.tradeCount) || signature.tradeCount !== totalTradeCount ||
      !Number.isSafeInteger(signature.observationCount) || signature.observationCount !== refs.length) {
    invalid("AGGREGATE_COUNTS");
  }

  if (typeof value.contentDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.contentDigest)) {
    invalid("CONTENT_DIGEST_FORMAT");
  }
  const { contentDigest, ...draft } = value as StructureClusterV2;
  if (buildStructureClusterV2ContentDigest(draft) !== contentDigest) invalid("CONTENT_DIGEST");
}
