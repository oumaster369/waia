import { formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import type { RiskDecisionOutcome } from "@/lib/trader/risk/types";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

export const RISK_VERDICT_V2_SCHEMA_VERSION = "risk-verdict/v2" as const;
export const CANONICAL_RISK_VERDICTS_V2 = [
  "APPROVE",
  "APPROVE_CLAMPED",
  "VETO",
  "CLOSE_ONLY",
  "HALT",
] as const;
export const RISK_BINDING_LAYERS_V2 = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"] as const;

export type CanonicalRiskVerdictV2 = (typeof CANONICAL_RISK_VERDICTS_V2)[number];
export type RiskBindingLayerV2 = (typeof RISK_BINDING_LAYERS_V2)[number];
export type RiskDecisionActionV2 = "ENTER_LONG" | "HOLD" | "REDUCE" | "CLOSE";

export type LegacyRiskVerdictMappingV2 = Readonly<{
  sourceVocabulary: "LEGACY_RISK_DECISION_V1";
  sourceOutcome: RiskDecisionOutcome;
  canonicalVerdict: CanonicalRiskVerdictV2;
  preservesHistoricalRecord: true;
}>;

const LEGACY_MAPPING: Readonly<Record<RiskDecisionOutcome, CanonicalRiskVerdictV2>> = Object.freeze({
  APPROVE: "APPROVE",
  RESIZE: "APPROVE_CLAMPED",
  REJECT: "VETO",
  CLOSE_ONLY: "CLOSE_ONLY",
  STOP_ACCOUNT: "HALT",
});

export function mapLegacyRiskOutcomeToV2(outcome: RiskDecisionOutcome): LegacyRiskVerdictMappingV2 {
  return Object.freeze({
    sourceVocabulary: "LEGACY_RISK_DECISION_V1",
    sourceOutcome: outcome,
    canonicalVerdict: LEGACY_MAPPING[outcome],
    preservesHistoricalRecord: true,
  });
}

export type RiskVerdictV2 = Readonly<{
  schemaVersion: typeof RISK_VERDICT_V2_SCHEMA_VERSION;
  riskVerdictId: string;
  organizationId: string;
  accountId: string;
  venue: string;
  market: "SPOT";
  symbol: string;
  baseAsset: string;
  quoteAsset: "USDT";
  instrumentIdentityDigestHex: string;
  decision: Readonly<{
    decisionId: string;
    semanticDigestHex: string;
    contentDigestHex: string;
    action: RiskDecisionActionV2;
    economicSizeSetId: string;
    economicSizeSetDigestHex: string;
  }>;
  riskPolicyVersion: string;
  riskPolicyDigestHex: string;
  limitVersions: readonly Readonly<{ layer: RiskBindingLayerV2; version: string; digestHex: string }>[];
  reality: Readonly<{
    snapshotId: string;
    contentDigestHex: string;
    asOfUtc: string;
    reconciliationAuthorityDigestHex: string;
    reconciliationStatus: "RECONCILED";
  }>;
  referencePrice: Readonly<{
    authorityId: string;
    authorityVersion: string;
    contentDigestHex: string;
    price: string;
  }>;
  admissionSequence: string;
  verdict: CanonicalRiskVerdictV2;
  approvedQualifiedQuantity: string | null;
  bindingLayers: readonly RiskBindingLayerV2[];
  reasonCodes: readonly string[];
  issuedAtUtc: string;
  semanticDigestHex: string;
  contentDigestHex: string;
}>;

export type RiskVerdictV2Draft = Omit<
  RiskVerdictV2,
  "schemaVersion" | "semanticDigestHex" | "contentDigestHex"
>;

const DIGEST = /^[0-9a-f]{64}$/;
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;
const LAYER_ORDINAL = new Map<RiskBindingLayerV2, number>(
  RISK_BINDING_LAYERS_V2.map((layer, index) => [layer, index]),
);

function requireText(value: string, field: string): void {
  if (value.trim() === "") throw new Error(`${field} is required`);
}

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw new Error(`${field} must be lowercase sha256 hex`);
}

function canonicalPositive(value: string): string {
  const parsed = parseDecimal(value);
  if (parsed <= 0n) throw new Error("approved/reference quantity must be positive");
  return formatDecimal(parsed);
}

function requireTimestamp(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error("timestamps must be canonical UTC milliseconds");
  }
}

function canonicalLayers(values: readonly RiskBindingLayerV2[]): RiskBindingLayerV2[] {
  return [...new Set(values)].sort((a, b) => LAYER_ORDINAL.get(a)! - LAYER_ORDINAL.get(b)!);
}

function canonicalReasons(values: readonly string[]): string[] {
  const canonical = [...new Set(values)].sort();
  if (canonical.some((value) => !REASON.test(value))) throw new Error("invalid Risk reason code");
  return canonical;
}

function semanticPayload(input: Omit<RiskVerdictV2, "semanticDigestHex" | "contentDigestHex">) {
  const { riskVerdictId: _id, issuedAtUtc: _issuedAt, ...semantic } = input;
  void _id;
  void _issuedAt;
  return semantic;
}

function validateDraft(input: RiskVerdictV2Draft): void {
  [
    [input.riskVerdictId, "riskVerdictId"],
    [input.organizationId, "organizationId"],
    [input.accountId, "accountId"],
    [input.venue, "venue"],
    [input.symbol, "symbol"],
    [input.baseAsset, "baseAsset"],
    [input.decision.decisionId, "decisionId"],
    [input.decision.economicSizeSetId, "economicSizeSetId"],
    [input.riskPolicyVersion, "riskPolicyVersion"],
    [input.reality.snapshotId, "reality.snapshotId"],
    [input.referencePrice.authorityId, "referencePrice.authorityId"],
    [input.referencePrice.authorityVersion, "referencePrice.authorityVersion"],
  ].forEach(([value, field]) => requireText(value!, field!));
  if (input.market !== "SPOT" || input.quoteAsset !== "USDT") throw new Error("only USDT SPOT is valid");
  if (input.symbol !== `${input.baseAsset}${input.quoteAsset}`) throw new Error("symbol binding mismatch");
  [
    [input.instrumentIdentityDigestHex, "instrumentIdentityDigestHex"],
    [input.decision.semanticDigestHex, "decision.semanticDigestHex"],
    [input.decision.contentDigestHex, "decision.contentDigestHex"],
    [input.decision.economicSizeSetDigestHex, "decision.economicSizeSetDigestHex"],
    [input.riskPolicyDigestHex, "riskPolicyDigestHex"],
    [input.reality.contentDigestHex, "reality.contentDigestHex"],
    [input.reality.reconciliationAuthorityDigestHex, "reconciliationAuthorityDigestHex"],
    [input.referencePrice.contentDigestHex, "referencePrice.contentDigestHex"],
  ].forEach(([value, field]) => requireDigest(value!, field!));
  input.limitVersions.forEach((entry) => {
    requireText(entry.version, "limitVersions.version");
    requireDigest(entry.digestHex, "limitVersions.digestHex");
  });
  if (!/^[1-9][0-9]*$/.test(input.admissionSequence)) throw new Error("invalid admission sequence");
  requireTimestamp(input.issuedAtUtc);
  requireTimestamp(input.reality.asOfUtc);
  canonicalPositive(input.referencePrice.price);
  const permits = ["APPROVE", "APPROVE_CLAMPED", "CLOSE_ONLY"].includes(input.verdict);
  if (permits !== (input.approvedQualifiedQuantity !== null)) {
    throw new Error("verdict/approved quantity mismatch");
  }
  if (input.approvedQualifiedQuantity !== null) canonicalPositive(input.approvedQualifiedQuantity);
  if (input.verdict !== "APPROVE" && input.reasonCodes.length === 0) {
    throw new Error("non-APPROVE verdict requires reason codes");
  }
  if (input.bindingLayers.length === 0) throw new Error("at least one binding layer is required");
}

function deepFreezeVerdict(input: RiskVerdictV2): RiskVerdictV2 {
  Object.freeze(input.decision);
  input.limitVersions.forEach(Object.freeze);
  Object.freeze(input.limitVersions);
  Object.freeze(input.reality);
  Object.freeze(input.referencePrice);
  Object.freeze(input.bindingLayers);
  Object.freeze(input.reasonCodes);
  return Object.freeze(input);
}

export function createRiskVerdictV2(draft: RiskVerdictV2Draft): RiskVerdictV2 {
  validateDraft(draft);
  const limitVersions = [...draft.limitVersions]
    .map((entry) => ({ ...entry }))
    .sort((a, b) => LAYER_ORDINAL.get(a.layer)! - LAYER_ORDINAL.get(b.layer)! || a.version.localeCompare(b.version));
  const withoutDigests = {
    ...draft,
    schemaVersion: RISK_VERDICT_V2_SCHEMA_VERSION,
    decision: { ...draft.decision },
    limitVersions,
    reality: { ...draft.reality },
    referencePrice: { ...draft.referencePrice, price: canonicalPositive(draft.referencePrice.price) },
    approvedQualifiedQuantity:
      draft.approvedQualifiedQuantity === null
        ? null
        : canonicalPositive(draft.approvedQualifiedQuantity),
    bindingLayers: canonicalLayers(draft.bindingLayers),
    reasonCodes: canonicalReasons(draft.reasonCodes),
  };
  const semanticDigestHex = computeStableJsonDigest(semanticPayload(withoutDigests));
  const withSemantic = { ...withoutDigests, semanticDigestHex };
  return deepFreezeVerdict({ ...withSemantic, contentDigestHex: computeStableJsonDigest(withSemantic) });
}

export function validateRiskVerdictV2(input: RiskVerdictV2): boolean {
  try {
    const { schemaVersion: _schema, semanticDigestHex: _semantic, contentDigestHex: _content, ...draft } = input;
    void _schema;
    void _semantic;
    void _content;
    const rebuilt = createRiskVerdictV2(draft);
    return (
      input.schemaVersion === RISK_VERDICT_V2_SCHEMA_VERSION &&
      rebuilt.semanticDigestHex === input.semanticDigestHex &&
      rebuilt.contentDigestHex === input.contentDigestHex
    );
  } catch {
    return false;
  }
}
