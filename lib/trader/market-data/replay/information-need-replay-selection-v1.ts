import {
  assertInformationAcquisitionSelectionV1,
  inquiryCanonicalTextCompare,
  type InformationAcquisitionSelectionV1,
  type InformationRequestedSourceV1,
} from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import { prepareCanonicalPitAttemptV1 } from "@/lib/trader/market-data/normalization/gateway-to-canonical-pit";
import type {
  FusedMarketContext,
  NormalizedObservation,
} from "@/lib/trader/market-data/observation-types";
import { resolveMarketDataProviderSelection } from "@/lib/trader/market-data/provider-registry";
import { FUTURE_EVIDENCE_EXCLUDED } from "@/lib/trader/market-data/replay/replay-lane-normalizer";
import {
  defineInformationAcquisitionReceiptV1,
  type InformationAcquisitionOutcomeReasonV1,
  type InformationAcquisitionOutcomeV1,
  type InformationAcquisitionReceiptV1,
} from "@/lib/trader/market-data/types";

function listReplayObservations(context: FusedMarketContext): NormalizedObservation[] {
  return [
    ...Object.values(context.mtfBars).flatMap((observations) => observations ?? []),
    context.primaryQuote,
    context.orderBookSnapshot,
    context.marketTradesSnapshot,
    context.crossExchangeConfirmation,
    context.fearGreed,
    context.globalMarket,
    ...(context.macroEvidence ?? []),
    ...(context.newsEvidence ?? []),
    ...(context.blockchainEvidence ?? []),
    ...(context.regulatoryEvidence ?? []),
    ...(context.protocolEvidence ?? []),
  ].filter((observation): observation is NormalizedObservation => observation !== undefined);
}

function rejectedOutcome(
  source: InformationRequestedSourceV1,
  reasonCode: InformationAcquisitionOutcomeReasonV1,
): InformationAcquisitionOutcomeV1 {
  return {
    requestedSource: source,
    status: "REJECTED",
    reasonCode,
    canonicalPitAttempts: [],
    observationContentDigests: [],
  };
}

function unavailableOutcome(source: InformationRequestedSourceV1): InformationAcquisitionOutcomeV1 {
  return {
    requestedSource: source,
    status: "UNAVAILABLE",
    reasonCode: "SOURCE_UNAVAILABLE",
    canonicalPitAttempts: [],
    observationContentDigests: [],
  };
}

function selectSourceAtPit(input: {
  source: InformationRequestedSourceV1;
  pitAnchor: string;
  observations: readonly NormalizedObservation[];
}): Readonly<{
  outcome: InformationAcquisitionOutcomeV1;
  lineageObservations: readonly NormalizedObservation[];
}> {
  const matching = input.observations
    .filter(
      (observation) =>
        observation.provenance.providerId === input.source.providerId &&
        (input.source.allowedObservationKinds as readonly string[]).includes(observation.kind),
    )
    .map((observation) => ({
      observation,
      attempt: prepareCanonicalPitAttemptV1(observation, { pitCutoffUtc: input.pitAnchor }),
    }))
    .map((entry) => ({ ...entry, digest: entry.attempt.normalizedInputDigest }))
    .sort((left, right) => inquiryCanonicalTextCompare(left.digest, right.digest))
    .filter((entry, index, entries) => index === 0 || entry.digest !== entries[index - 1]?.digest);

  if (matching.length === 0) {
    return { outcome: unavailableOutcome(input.source), lineageObservations: [] };
  }
  if (
    matching.some(
      ({ observation }) =>
        (observation.payload as { reason?: unknown }).reason === FUTURE_EVIDENCE_EXCLUDED,
    )
  ) {
    return {
      outcome: rejectedOutcome(input.source, "INVALID_CHRONOLOGY"),
      lineageObservations: [],
    };
  }

  const available = matching.filter((entry) => entry.attempt.status === "AVAILABLE");
  const rejected = matching.filter((entry) => entry.attempt.status === "REJECTED");
  const unavailable = matching.filter((entry) => entry.attempt.status === "UNAVAILABLE");
  const selected = available.length > 0 ? available : rejected.length > 0 ? rejected : unavailable;
  const status =
    available.length > 0 ? "AVAILABLE" : rejected.length > 0 ? "REJECTED" : "UNAVAILABLE";
  return {
    outcome: {
      requestedSource: input.source,
      status,
      reasonCode:
        status === "AVAILABLE" ? null : (selected[0]?.attempt.reason ?? "SOURCE_UNAVAILABLE"),
      canonicalPitAttempts: selected.map((entry) => entry.attempt),
      observationContentDigests:
        status === "AVAILABLE" ? selected.map((entry) => entry.digest) : [],
    },
    lineageObservations: selected.map((entry) => entry.observation),
  };
}

export function selectInformationNeedReplayEvidenceV1(input: {
  selection: InformationAcquisitionSelectionV1;
  context: FusedMarketContext;
  pitAnchor: string;
}): InformationAcquisitionReceiptV1 {
  const selection = assertInformationAcquisitionSelectionV1(input.selection);
  const scopeReason =
    selection.mode !== "HISTORICAL"
      ? "SELECTION_MODE_MISMATCH"
      : selection.symbol !== input.context.instrumentId || selection.pitAnchor !== input.pitAnchor
        ? "SELECTION_SCOPE_MISMATCH"
        : null;
  const observations = listReplayObservations(input.context);
  const resolvedOutcomes = selection.requestedSources.map((source) => {
    if (scopeReason) {
      return { outcome: rejectedOutcome(source, scopeReason), lineageObservations: [] };
    }
    const provider = resolveMarketDataProviderSelection(source);
    if (provider.status === "REJECTED") {
      return {
        outcome: rejectedOutcome(source, provider.reasonCode),
        lineageObservations: [],
      };
    }
    return selectSourceAtPit({ source, pitAnchor: input.pitAnchor, observations });
  });
  const lineageObservations = new Map<string, NormalizedObservation>();
  for (const observation of resolvedOutcomes.flatMap((resolved) => resolved.lineageObservations)) {
    const digest = prepareCanonicalPitAttemptV1(observation, {
      pitCutoffUtc: selection.pitAnchor,
    }).normalizedInputDigest;
    if (!lineageObservations.has(digest)) lineageObservations.set(digest, observation);
  }
  return defineInformationAcquisitionReceiptV1({
    selection,
    outcomes: resolvedOutcomes.map((resolved) => resolved.outcome),
    observations: [...lineageObservations.values()],
  });
}
