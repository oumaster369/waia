import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import type { ProtectivePostureV2 } from "./protective-posture-v2";
import type { RiskDecisionActionV2, RiskVerdictV2 } from "./risk-verdict-contract-v2";

export const RISK_ALLOWANCE_V2_SCHEMA_VERSION = "risk-allowance/v2" as const;
export const RISK_ALLOWANCE_LIFECYCLE_STATES_V2 = [
  "ISSUED",
  "CONSUMED",
  "REVOKED",
  "EXPIRED",
] as const;

export type RiskAllowanceLifecycleStateV2 =
  (typeof RISK_ALLOWANCE_LIFECYCLE_STATES_V2)[number];

export type RiskAllowanceV2 = Readonly<{
  schemaVersion: typeof RISK_ALLOWANCE_V2_SCHEMA_VERSION;
  riskAllowanceId: string;
  organizationId: string;
  accountId: string;
  venue: string;
  market: "SPOT";
  symbol: string;
  baseAsset: string;
  quoteAsset: "USDT";
  instrumentIdentityDigestHex: string;
  riskVerdictId: string;
  riskVerdictContentDigestHex: string;
  admissionSequence: string;
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
  realitySnapshotId: string;
  realityContentDigestHex: string;
  reconciliationAuthorityDigestHex: string;
  postureAtIssuance: ProtectivePostureV2;
  strictExposureReduction: boolean;
  exactQualifiedQuantity: string;
  reservedExposureNotional: string;
  nonce: string;
  lifecycleState: "ISSUED";
  issuedAtUtc: string;
  validUntilUtc: string;
  semanticDigestHex: string;
  contentDigestHex: string;
}>;

export type RiskAllowanceV2Draft = Omit<
  RiskAllowanceV2,
  "schemaVersion" | "lifecycleState" | "semanticDigestHex" | "contentDigestHex"
>;

const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requireText(value: string, field: string): void {
  if (value.trim() === "") throw new Error(`${field} is required`);
}

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw new Error(`${field} must be lowercase sha256 hex`);
}

function canonicalPositive(value: string): string {
  const parsed = parseDecimal(value);
  if (parsed <= 0n) throw new Error("allowance quantity must be positive");
  return formatDecimal(parsed);
}

function canonicalNonnegative(value: string): string {
  const parsed = parseDecimal(value);
  if (parsed < 0n) throw new Error("reserved exposure must be nonnegative");
  return formatDecimal(parsed);
}

function canonicalTimestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("allowance timestamps must be canonical UTC milliseconds");
  }
  return value;
}

function semanticPayload(
  input: Omit<RiskAllowanceV2, "semanticDigestHex" | "contentDigestHex">,
) {
  const { riskAllowanceId: _id, issuedAtUtc: _issuedAt, nonce: _nonce, ...semantic } = input;
  void _id;
  void _issuedAt;
  void _nonce;
  return semantic;
}

export function createRiskAllowanceV2(draft: RiskAllowanceV2Draft): RiskAllowanceV2 {
  [
    [draft.riskAllowanceId, "riskAllowanceId"],
    [draft.organizationId, "organizationId"],
    [draft.accountId, "accountId"],
    [draft.venue, "venue"],
    [draft.symbol, "symbol"],
    [draft.baseAsset, "baseAsset"],
    [draft.riskVerdictId, "riskVerdictId"],
    [draft.decision.decisionId, "decisionId"],
    [draft.decision.economicSizeSetId, "economicSizeSetId"],
    [draft.riskPolicyVersion, "riskPolicyVersion"],
    [draft.realitySnapshotId, "realitySnapshotId"],
  ].forEach(([value, field]) => requireText(value!, field!));
  if (!UUID.test(draft.nonce)) throw new Error("allowance nonce must be a canonical UUID");
  if (!/^[1-9][0-9]*$/.test(draft.admissionSequence)) throw new Error("invalid admission sequence");
  if (draft.market !== "SPOT" || draft.quoteAsset !== "USDT") {
    throw new Error("RiskAllowanceV2 is USDT SPOT only");
  }
  if (draft.symbol !== `${draft.baseAsset}${draft.quoteAsset}`) {
    throw new Error("allowance symbol binding mismatch");
  }
  [
    [draft.instrumentIdentityDigestHex, "instrumentIdentityDigestHex"],
    [draft.riskVerdictContentDigestHex, "riskVerdictContentDigestHex"],
    [draft.decision.semanticDigestHex, "decision.semanticDigestHex"],
    [draft.decision.contentDigestHex, "decision.contentDigestHex"],
    [draft.decision.economicSizeSetDigestHex, "decision.economicSizeSetDigestHex"],
    [draft.riskPolicyDigestHex, "riskPolicyDigestHex"],
    [draft.realityContentDigestHex, "realityContentDigestHex"],
    [draft.reconciliationAuthorityDigestHex, "reconciliationAuthorityDigestHex"],
  ].forEach(([value, field]) => requireDigest(value!, field!));
  const issuedAtUtc = canonicalTimestamp(draft.issuedAtUtc);
  const validUntilUtc = canonicalTimestamp(draft.validUntilUtc);
  if (new Date(validUntilUtc).getTime() <= new Date(issuedAtUtc).getTime()) {
    throw new Error("allowance validity must end after issuance");
  }
  if (draft.postureAtIssuance === "HALT" || draft.postureAtIssuance === "KILLED") {
    throw new Error("HALT/KILLED cannot issue an allowance");
  }
  if (draft.postureAtIssuance === "CLOSE_ONLY" && !draft.strictExposureReduction) {
    throw new Error("CLOSE_ONLY allowance must be a strict exposure reduction");
  }
  const withoutDigests = {
    ...draft,
    schemaVersion: RISK_ALLOWANCE_V2_SCHEMA_VERSION,
    lifecycleState: "ISSUED" as const,
    decision: { ...draft.decision },
    exactQualifiedQuantity: canonicalPositive(draft.exactQualifiedQuantity),
    reservedExposureNotional: canonicalNonnegative(draft.reservedExposureNotional),
    issuedAtUtc,
    validUntilUtc,
  };
  const semanticDigestHex = computeStableJsonDigest(semanticPayload(withoutDigests));
  const withSemantic = { ...withoutDigests, semanticDigestHex };
  Object.freeze(withSemantic.decision);
  return Object.freeze({
    ...withSemantic,
    contentDigestHex: computeStableJsonDigest(withSemantic),
  });
}

export function createRiskAllowanceV2FromVerdict(input: {
  riskAllowanceId: string;
  verdict: RiskVerdictV2;
  postureAtIssuance: ProtectivePostureV2;
  strictExposureReduction: boolean;
  reservedExposureNotional: string;
  nonce: string;
  validUntilUtc: string;
}): RiskAllowanceV2 {
  if (input.verdict.approvedQualifiedQuantity === null) {
    throw new Error("non-permitting Risk verdict cannot produce an allowance");
  }
  return createRiskAllowanceV2({
    riskAllowanceId: input.riskAllowanceId,
    organizationId: input.verdict.organizationId,
    accountId: input.verdict.accountId,
    venue: input.verdict.venue,
    market: input.verdict.market,
    symbol: input.verdict.symbol,
    baseAsset: input.verdict.baseAsset,
    quoteAsset: input.verdict.quoteAsset,
    instrumentIdentityDigestHex: input.verdict.instrumentIdentityDigestHex,
    riskVerdictId: input.verdict.riskVerdictId,
    riskVerdictContentDigestHex: input.verdict.contentDigestHex,
    admissionSequence: input.verdict.admissionSequence,
    decision: { ...input.verdict.decision },
    riskPolicyVersion: input.verdict.riskPolicyVersion,
    riskPolicyDigestHex: input.verdict.riskPolicyDigestHex,
    realitySnapshotId: input.verdict.reality.snapshotId,
    realityContentDigestHex: input.verdict.reality.contentDigestHex,
    reconciliationAuthorityDigestHex: input.verdict.reality.reconciliationAuthorityDigestHex,
    postureAtIssuance: input.postureAtIssuance,
    strictExposureReduction: input.strictExposureReduction,
    exactQualifiedQuantity: input.verdict.approvedQualifiedQuantity,
    reservedExposureNotional: input.reservedExposureNotional,
    nonce: input.nonce,
    issuedAtUtc: input.verdict.issuedAtUtc,
    validUntilUtc: input.validUntilUtc,
  });
}

export function validateRiskAllowanceV2(input: RiskAllowanceV2): boolean {
  try {
    const {
      schemaVersion: _schema,
      lifecycleState: _state,
      semanticDigestHex: _semantic,
      contentDigestHex: _content,
      ...draft
    } = input;
    void _schema;
    void _state;
    void _semantic;
    void _content;
    const rebuilt = createRiskAllowanceV2(draft);
    return (
      input.schemaVersion === RISK_ALLOWANCE_V2_SCHEMA_VERSION &&
      input.lifecycleState === "ISSUED" &&
      input.semanticDigestHex === rebuilt.semanticDigestHex &&
      input.contentDigestHex === rebuilt.contentDigestHex
    );
  } catch {
    return false;
  }
}
