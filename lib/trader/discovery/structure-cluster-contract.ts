import type { ResearchCampaignRef } from "@/lib/trader/discovery/discovery.types";
import { buildStructureClusterV2ContentDigest } from "@/lib/trader/discovery/serialize-discovery";
import { assertNoBannedFields } from "@/lib/trader/discovery/no-reinforcement-guard";
import {
  MEASURED_VOLATILITY_UNAVAILABLE,
  STRUCTURE_CLUSTER_SCHEMA_VERSION_V1,
  STRUCTURE_CLUSTER_SCHEMA_VERSION_V2,
  TRADE_REFERENCE_COUNT_BAND,
  TRADE_REFERENCE_COUNT_METRIC,
  type StructureClusterV1,
  type StructureClusterV2,
  type TradeReferenceCountBand,
} from "@/lib/trader/discovery/structure.types";

export type StructureClusterContractCode =
  | "LEGACY_V1_NOT_ACCEPTED"
  | "MALFORMED_METRIC"
  | "COUNT_BAND_INCONSISTENT"
  | "WRONG_VERSION"
  | "DIGEST_MISMATCH"
  | "MALFORMED_CLUSTER";

export class StructureClusterContractError extends Error {
  readonly code: StructureClusterContractCode;

  constructor(code: StructureClusterContractCode, message: string) {
    super(message);
    this.name = "StructureClusterContractError";
    this.code = code;
  }
}

const CAMPAIGN_STATES = new Set<ResearchCampaignRef["state"]>([
  "PROPOSED",
  "ACTIVE",
  "PAUSED",
  "CONSOLIDATING",
  "CONSOLIDATED",
  "ARCHIVED",
]);

const COUNT_BANDS = new Set<string>(Object.values(TRADE_REFERENCE_COUNT_BAND));

export function tradeReferenceCountBandForCount(count: number): TradeReferenceCountBand {
  if (!Number.isInteger(count) || count < 0) {
    throw new StructureClusterContractError(
      "COUNT_BAND_INCONSISTENT",
      "Trade-reference count must be a non-negative integer.",
    );
  }
  if (count <= 1) {
    return TRADE_REFERENCE_COUNT_BAND.le1;
  }
  if (count <= 5) {
    return TRADE_REFERENCE_COUNT_BAND.from2To5;
  }
  return TRADE_REFERENCE_COUNT_BAND.gt5;
}

export function buildStructureSignatureKeyV2(
  regimeLabel: string,
  band: TradeReferenceCountBand,
): string {
  return `discovery-structure-v2::${regimeLabel}::${band}`;
}

export function countBandMatchesAggregate(
  band: TradeReferenceCountBand,
  tradeCount: number,
  observationCount: number,
): boolean {
  if (!Number.isInteger(tradeCount) || tradeCount < 0) {
    return false;
  }
  if (!Number.isInteger(observationCount) || observationCount < 1) {
    return false;
  }
  if (band === TRADE_REFERENCE_COUNT_BAND.le1) {
    return tradeCount <= observationCount;
  }
  if (band === TRADE_REFERENCE_COUNT_BAND.from2To5) {
    return tradeCount >= 2 * observationCount && tradeCount <= 5 * observationCount;
  }
  return tradeCount >= 6 * observationCount;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectKeys(value: unknown): string[] {
  if (!isRecord(value) && !Array.isArray(value)) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectKeys(entry));
  }
  return Object.keys(value).flatMap((key) => [key, ...collectKeys(value[key])]);
}

function fail(code: StructureClusterContractCode, message: string): never {
  throw new StructureClusterContractError(code, message);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("MALFORMED_CLUSTER", `${label} must be a non-empty string.`);
  }
  return value;
}

export type StoredStructureCluster =
  | { kind: "v1"; cluster: StructureClusterV1 }
  | { kind: "v2"; cluster: StructureClusterV2 };

/** Read a stored opaque payload without upgrading legacy V1 bytes. */
export function readStoredStructureClusterPayload(payloadJson: string): StoredStructureCluster {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson) as unknown;
  } catch {
    fail("MALFORMED_CLUSTER", "Structure cluster payload is not JSON.");
  }
  if (!isRecord(parsed)) {
    fail("MALFORMED_CLUSTER", "Structure cluster payload must be an object.");
  }
  if (parsed.schemaVersion === STRUCTURE_CLUSTER_SCHEMA_VERSION_V1) {
    return { kind: "v1", cluster: parsed as StructureClusterV1 };
  }
  if (parsed.schemaVersion === STRUCTURE_CLUSTER_SCHEMA_VERSION_V2) {
    return { kind: "v2", cluster: assertValidStructureClusterV2(parsed) };
  }
  fail("WRONG_VERSION", "Structure cluster schema version is not supported.");
}

export function assertValidStructureClusterV2(input: unknown): StructureClusterV2 {
  if (!isRecord(input)) {
    fail("MALFORMED_CLUSTER", "Structure cluster must be an object.");
  }
  if (input.schemaVersion === STRUCTURE_CLUSTER_SCHEMA_VERSION_V1) {
    fail("LEGACY_V1_NOT_ACCEPTED", "Legacy V1 structure clusters cannot be used as new V2 input.");
  }
  if (input.schemaVersion !== STRUCTURE_CLUSTER_SCHEMA_VERSION_V2) {
    fail("WRONG_VERSION", "Structure cluster schema version must be V2.");
  }

  const keys = collectKeys(input);
  if (keys.includes("volBucket")) {
    fail("MALFORMED_METRIC", "V2 structure clusters cannot carry a volatility bucket.");
  }
  assertNoBannedFields(input, "structure cluster");

  const signature = input.signature;
  if (!isRecord(signature)) {
    fail("MALFORMED_CLUSTER", "Structure cluster signature must be an object.");
  }
  if (signature.metric !== TRADE_REFERENCE_COUNT_METRIC) {
    fail("MALFORMED_METRIC", "V2 structure clusters must use the trade-reference count metric.");
  }
  if (signature.measuredVolatility !== MEASURED_VOLATILITY_UNAVAILABLE) {
    fail("MALFORMED_METRIC", "Measured volatility is unavailable on V2 structure clusters.");
  }
  if (
    typeof signature.tradeReferenceCountBand !== "string" ||
    !COUNT_BANDS.has(signature.tradeReferenceCountBand)
  ) {
    fail("MALFORMED_METRIC", "Trade-reference count band is not a known descriptive cutpoint.");
  }

  const band = signature.tradeReferenceCountBand as TradeReferenceCountBand;
  const regimeLabel = requireString(signature.regimeLabel, "Regime label");
  const signatureKey = requireString(signature.signatureKey, "Signature key");
  const expectedKey = buildStructureSignatureKeyV2(regimeLabel, band);
  if (signatureKey !== expectedKey) {
    fail("WRONG_VERSION", "V2 signature key does not match the versioned count-band identity.");
  }

  const tradeCount = signature.tradeCount;
  const observationCount = signature.observationCount;
  if (
    typeof tradeCount !== "number" ||
    typeof observationCount !== "number" ||
    !countBandMatchesAggregate(band, tradeCount, observationCount)
  ) {
    fail(
      "COUNT_BAND_INCONSISTENT",
      "Trade-reference count and observation count cannot produce the declared band.",
    );
  }

  const campaignRef = input.campaignRef;
  if (!isRecord(campaignRef)) {
    fail("MALFORMED_CLUSTER", "Campaign reference must be an object.");
  }
  const state = campaignRef.state;
  if (typeof state !== "string" || !CAMPAIGN_STATES.has(state as ResearchCampaignRef["state"])) {
    fail("MALFORMED_CLUSTER", "Campaign reference state is not recognized.");
  }
  const members = input.memberObservationRefs;
  if (
    !Array.isArray(members) ||
    members.length === 0 ||
    members.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    fail("MALFORMED_CLUSTER", "Member observation refs must be a non-empty string list.");
  }
  const memberObservationRefs = members as string[];
  const sorted = [...memberObservationRefs].sort((a, b) => a.localeCompare(b));
  if (
    new Set(memberObservationRefs).size !== memberObservationRefs.length ||
    memberObservationRefs.some((entry, index) => entry !== sorted[index])
  ) {
    fail(
      "MALFORMED_CLUSTER",
      "Member observation refs must be unique and deterministically sorted.",
    );
  }

  const draft = {
    schemaVersion: STRUCTURE_CLUSTER_SCHEMA_VERSION_V2,
    clusterId: requireString(input.clusterId, "Cluster id"),
    campaignRef: {
      campaignId: requireString(campaignRef.campaignId, "Campaign id"),
      campaignDigest: requireString(campaignRef.campaignDigest, "Campaign digest"),
      state: state as ResearchCampaignRef["state"],
    },
    signature: {
      signatureKey,
      regimeLabel,
      metric: TRADE_REFERENCE_COUNT_METRIC,
      tradeReferenceCountBand: band,
      measuredVolatility: MEASURED_VOLATILITY_UNAVAILABLE,
      tradeCount,
      observationCount,
    },
    memberObservationRefs,
    createdAt: requireString(input.createdAt, "Created at"),
  } satisfies Omit<StructureClusterV2, "contentDigest">;

  const contentDigest = requireString(input.contentDigest, "Content digest");
  const expectedDigest = buildStructureClusterV2ContentDigest(draft);
  if (contentDigest !== expectedDigest) {
    fail(
      "DIGEST_MISMATCH",
      "V2 structure cluster content digest does not match its canonical body.",
    );
  }

  return { ...draft, contentDigest };
}

export function assertStructureClusterV2AppendRow(row: {
  id: string;
  organizationId: string;
  campaignId: string;
  signatureKey: string;
  payloadJson: string;
  contentDigest: string;
}): StructureClusterV2 {
  if (row.organizationId.length === 0) {
    fail("MALFORMED_CLUSTER", "Organization id is required before appending a structure cluster.");
  }
  const stored = readStoredStructureClusterPayload(row.payloadJson);
  if (stored.kind === "v1") {
    fail(
      "LEGACY_V1_NOT_ACCEPTED",
      "Legacy V1 structure clusters remain readable and are not appended as V2.",
    );
  }
  const cluster = stored.cluster;
  if (row.id !== cluster.clusterId || row.campaignId !== cluster.campaignRef.campaignId) {
    fail(
      "MALFORMED_CLUSTER",
      "Append row identity does not match the V2 structure cluster payload.",
    );
  }
  if (row.signatureKey !== cluster.signature.signatureKey) {
    fail("WRONG_VERSION", "Append row signature key does not match the V2 structure cluster.");
  }
  if (row.contentDigest !== cluster.contentDigest) {
    fail("DIGEST_MISMATCH", "Append row content digest does not match the V2 structure cluster.");
  }
  return cluster;
}
