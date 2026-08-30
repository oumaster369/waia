import type { PositionLotRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import { parseOpeningCausalLineageV1 } from "@/lib/trader/lifecycle/opening-causal-lineage-v1";
import {
  validateRealityProjectionV2,
  type RealityProjectionV2,
} from "@/lib/trader/reality/v2/contracts";
import { isPositiveDecimal } from "@/lib/trader/risk/numeric";

import {
  buildGuardianAssessmentV2,
  type GuardianAssessmentV2,
  type GuardianV2Recommendation,
  type GuardianV2Sufficiency,
} from "./guardian-assessment-v2";

export type QualifiedGuardianEvidenceV2 = Readonly<{
  organizationId: string;
  symbol: string;
  evidenceBundleId: string;
  evidenceContentDigest: string;
  profile: "OPEN_POSITION_REASSESSMENT";
  openPositionSufficiency: GuardianV2Sufficiency;
  newOpportunitySufficiency: GuardianV2Sufficiency;
}>;

export function buildGuardianAssessmentFromCanonicalInputsV2(input: Readonly<{
  organizationId: string;
  lot: PositionLotRow;
  reality: RealityProjectionV2;
  evidence: QualifiedGuardianEvidenceV2;
  recommendation: GuardianV2Recommendation;
  targetReductionBps: number;
  reasonCodes: readonly string[];
}>): GuardianAssessmentV2 {
  if (input.lot.organizationId !== input.organizationId) {
    throw new Error("GUARDIAN_V2_LOT_TENANT_MISMATCH");
  }
  if (input.lot.state !== "OPEN" || !isPositiveDecimal(input.lot.remainingQty)) {
    throw new Error("GUARDIAN_V2_LOT_NOT_CANONICALLY_OPEN");
  }
  if (input.reality.organizationId !== input.organizationId) {
    throw new Error("GUARDIAN_V2_REALITY_TENANT_MISMATCH");
  }
  if (input.reality.accountId !== input.lot.accountKey) {
    throw new Error("GUARDIAN_V2_REALITY_ACCOUNT_MISMATCH");
  }
  if (!validateRealityProjectionV2(input.reality)) {
    throw new Error("GUARDIAN_V2_REALITY_INVALID");
  }
  if (
    input.evidence.organizationId !== input.organizationId ||
    input.evidence.symbol !== input.lot.symbol
  ) {
    throw new Error("GUARDIAN_V2_EVIDENCE_SCOPE_MISMATCH");
  }
  if (input.evidence.profile !== "OPEN_POSITION_REASSESSMENT") {
    throw new Error("GUARDIAN_V2_EVIDENCE_PROFILE_MISMATCH");
  }
  if (!input.lot.openingCausalLineageJson || !input.lot.openingCausalLineageDigest) {
    throw new Error("GUARDIAN_V2_OPENING_LINEAGE_MISSING");
  }
  const openingLineage = parseOpeningCausalLineageV1(input.lot.openingCausalLineageJson);
  if (
    openingLineage.organizationId !== input.organizationId ||
    openingLineage.symbol !== input.lot.symbol ||
    openingLineage.contentDigest !== input.lot.openingCausalLineageDigest
  ) {
    throw new Error("GUARDIAN_V2_OPENING_LINEAGE_MISMATCH");
  }

  return buildGuardianAssessmentV2({
    organizationId: input.organizationId,
    positionId: input.lot.tradeId,
    lotId: input.lot.id,
    symbol: input.lot.symbol,
    openingCausalLineageDigest: openingLineage.contentDigest,
    realityFrontierId: input.reality.projectionId,
    realityContentDigest: input.reality.contentDigestHex,
    qualifiedEvidenceBundleId: input.evidence.evidenceBundleId,
    qualifiedEvidenceContentDigest: input.evidence.evidenceContentDigest,
    informationSufficiencyProfile: input.evidence.profile,
    openPositionSufficiency: input.evidence.openPositionSufficiency,
    newOpportunitySufficiency: input.evidence.newOpportunitySufficiency,
    recommendation: input.recommendation,
    targetReductionBps: input.targetReductionBps,
    reasonCodes: input.reasonCodes,
  });
}

