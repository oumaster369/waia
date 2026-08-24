import {
  INFORMATION_INQUIRY_TIMEFRAMES_V1,
  INFORMATION_INQUIRY_TIMEFRAME_ROLES_V1,
  inquiryCanonicalTextCompare,
  requireInquiryDigest,
  requireInquiryNonEmpty,
  requireInquiryTimestamp,
  sortInquiryUniqueStrings,
  type InformationInquiryTimeframeRoleV1,
  type InformationInquiryTimeframeV1,
} from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

export const TOP_DOWN_RECONSTRUCTION_V1_SCHEMA_VERSION = "top_down_reconstruction/v1" as const;

export const TOP_DOWN_TIMEFRAME_RELATIONS_V1 = [
  "CONFIRMING",
  "CORRECTIVE",
  "TRANSITIONING",
  "CONFLICTING",
  "UNCLEAR",
] as const;
export type TopDownTimeframeRelationV1 = (typeof TOP_DOWN_TIMEFRAME_RELATIONS_V1)[number];

export type TopDownTimeframeStateV1 = Readonly<{
  timeframe: InformationInquiryTimeframeV1;
  role: InformationInquiryTimeframeRoleV1;
  status: "AVAILABLE" | "UNAVAILABLE" | "CONTRADICTORY";
  stateContentDigest: string | null;
  evidenceIds: readonly string[];
  reasonCodes: readonly string[];
}>;

export type TopDownRelationV1 = Readonly<{
  higherTimeframe: InformationInquiryTimeframeV1;
  lowerTimeframe: InformationInquiryTimeframeV1;
  relation: TopDownTimeframeRelationV1;
  relationPolicyVersion: string;
  relationPolicyContentDigest: string;
  evidenceIds: readonly string[];
  reasonCodes: readonly string[];
}>;

export type TopDownReevaluationRequestV1 = Readonly<{
  triggerTimeframe: "4h" | "1h" | "15m" | "1m";
  targetHigherTimeframe: "1d" | "4h" | "1h" | "15m";
  triggerEvidenceIds: readonly string[];
  reasonCodes: readonly string[];
  mayOverwriteHigherState: false;
}>;

export type TopDownReconstructionV1 = Readonly<{
  schemaVersion: typeof TOP_DOWN_RECONSTRUCTION_V1_SCHEMA_VERSION;
  symbol: string;
  pitAnchor: string;
  states: readonly TopDownTimeframeStateV1[];
  relations: readonly TopDownRelationV1[];
  upwardReevaluationRequests: readonly TopDownReevaluationRequestV1[];
  authority: "MARKET_RECONSTRUCTION_ONLY";
  contentDigest: string;
}>;

const ROLE_BY_TIMEFRAME: Readonly<
  Record<InformationInquiryTimeframeV1, InformationInquiryTimeframeRoleV1>
> = Object.freeze({
  "1d": "STRATEGIC_CONTEXT",
  "4h": "STRUCTURAL_REFINEMENT",
  "1h": "OPERATIONAL_STATE",
  "15m": "SETUP_CONFIRMATION",
  "1m": "EXECUTION_PRECISION",
});

const ADJACENT_PAIRS = [
  ["1d", "4h"],
  ["4h", "1h"],
  ["1h", "15m"],
  ["15m", "1m"],
] as const;

function timeframeIndex(timeframe: InformationInquiryTimeframeV1): number {
  return INFORMATION_INQUIRY_TIMEFRAMES_V1.indexOf(timeframe);
}

export function defineTopDownReconstructionV1(input: Omit<
  TopDownReconstructionV1,
  "schemaVersion" | "authority" | "contentDigest"
>): TopDownReconstructionV1 {
  requireInquiryNonEmpty(input.symbol, "reconstruction.symbol");
  requireInquiryTimestamp(input.pitAnchor, "reconstruction.pitAnchor");
  if (input.states.length !== INFORMATION_INQUIRY_TIMEFRAMES_V1.length) {
    throw new Error("INFORMATION_INQUIRY_INVALID:reconstruction.states");
  }

  const states = INFORMATION_INQUIRY_TIMEFRAMES_V1.map((timeframe, index) => {
    const state = input.states[index];
    if (!state || state.timeframe !== timeframe || state.role !== ROLE_BY_TIMEFRAME[timeframe]) {
      throw new Error(`INFORMATION_INQUIRY_INVALID:reconstruction.stateOrder.${timeframe}`);
    }
    if (!INFORMATION_INQUIRY_TIMEFRAME_ROLES_V1.includes(state.role)) {
      throw new Error("INFORMATION_INQUIRY_INVALID:reconstruction.role");
    }
    if (state.status === "AVAILABLE" && state.stateContentDigest === null) {
      throw new Error("INFORMATION_INQUIRY_INVALID:reconstruction.availableDigest");
    }
    if (state.stateContentDigest !== null) {
      requireInquiryDigest(state.stateContentDigest, "reconstruction.stateContentDigest");
    }
    return {
      ...state,
      evidenceIds: sortInquiryUniqueStrings(state.evidenceIds, "reconstruction.evidenceId"),
      reasonCodes: sortInquiryUniqueStrings(state.reasonCodes, "reconstruction.reasonCode"),
    };
  });

  if (input.relations.length !== ADJACENT_PAIRS.length) {
    throw new Error("INFORMATION_INQUIRY_INVALID:reconstruction.relations");
  }
  const relations = ADJACENT_PAIRS.map(([higherTimeframe, lowerTimeframe], index) => {
    const relation = input.relations[index];
    if (
      !relation ||
      relation.higherTimeframe !== higherTimeframe ||
      relation.lowerTimeframe !== lowerTimeframe ||
      !TOP_DOWN_TIMEFRAME_RELATIONS_V1.includes(relation.relation)
    ) {
      throw new Error(`INFORMATION_INQUIRY_INVALID:reconstruction.relationOrder.${index}`);
    }
    requireInquiryNonEmpty(relation.relationPolicyVersion, "relationPolicyVersion");
    requireInquiryDigest(relation.relationPolicyContentDigest, "relationPolicyContentDigest");
    return {
      ...relation,
      evidenceIds: sortInquiryUniqueStrings(relation.evidenceIds, "relationEvidenceId"),
      reasonCodes: sortInquiryUniqueStrings(relation.reasonCodes, "relationReasonCode"),
    };
  });

  const upwardReevaluationRequests = [...input.upwardReevaluationRequests]
    .map((request) => {
      if (
        timeframeIndex(request.targetHigherTimeframe) >= timeframeIndex(request.triggerTimeframe) ||
        request.mayOverwriteHigherState !== false
      ) {
        throw new Error("INFORMATION_INQUIRY_INVALID:upwardReevaluationDirection");
      }
      return {
        ...request,
        triggerEvidenceIds: sortInquiryUniqueStrings(
          request.triggerEvidenceIds,
          "reevaluationEvidenceId",
        ),
        reasonCodes: sortInquiryUniqueStrings(request.reasonCodes, "reevaluationReasonCode"),
        mayOverwriteHigherState: false as const,
      };
    })
    .sort((left, right) =>
      inquiryCanonicalTextCompare(
        `${left.triggerTimeframe}\u0000${left.targetHigherTimeframe}`,
        `${right.triggerTimeframe}\u0000${right.targetHigherTimeframe}`,
      ),
    );

  const payload = {
    schemaVersion: TOP_DOWN_RECONSTRUCTION_V1_SCHEMA_VERSION,
    symbol: input.symbol,
    pitAnchor: input.pitAnchor,
    states,
    relations,
    upwardReevaluationRequests,
    authority: "MARKET_RECONSTRUCTION_ONLY" as const,
  };
  return Object.freeze({ ...payload, contentDigest: computeStableJsonDigest(payload) });
}

export function assertTopDownReconstructionV1(
  reconstruction: TopDownReconstructionV1,
): TopDownReconstructionV1 {
  const expected = defineTopDownReconstructionV1({
    symbol: reconstruction.symbol,
    pitAnchor: reconstruction.pitAnchor,
    states: reconstruction.states,
    relations: reconstruction.relations,
    upwardReevaluationRequests: reconstruction.upwardReevaluationRequests,
  });
  if (
    reconstruction.schemaVersion !== expected.schemaVersion ||
    reconstruction.authority !== expected.authority ||
    reconstruction.contentDigest !== expected.contentDigest
  ) {
    throw new Error("INFORMATION_INQUIRY_INVALID:reconstructionIdentity");
  }
  return reconstruction;
}
