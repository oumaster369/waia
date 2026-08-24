import type { Bar, Quote, InstrumentId } from "@/lib/trader/intelligence/types";
import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";
import {
  assertInformationAcquisitionSelectionV1,
  computeInquiryContentDigest,
  deepFreezeInquiry,
  inquiryCanonicalJsonString,
  inquiryCanonicalTextCompare,
  type InformationAcquisitionSelectionV1,
  type InformationRequestedSourceV1,
} from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import type { CanonicalGatewayRejectionReasonV1 } from "@/lib/trader/mi/canonical-observation-v1";
import {
  prepareCanonicalPitAttemptV1,
  type PreparedCanonicalPitAttemptV1,
} from "@/lib/trader/market-data/normalization/gateway-to-canonical-pit";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";

export const INFORMATION_ACQUISITION_RECEIPT_V1_SCHEMA_VERSION =
  "information_acquisition_receipt/v1" as const;

export type InformationAcquisitionOutcomeReasonV1 =
  | CanonicalGatewayRejectionReasonV1
  | "SELECTION_MODE_MISMATCH"
  | "SELECTION_SCOPE_MISMATCH"
  | "PROVIDER_KIND_MISMATCH"
  | "SOURCE_RETURNED_NO_ADMITTED_OBSERVATION";

const INFORMATION_ACQUISITION_OUTCOME_REASONS_V1 = [
  "EXCLUDED_UNMODELED",
  "INVALID_SCHEMA_VERSION",
  "INVALID_PROVENANCE",
  "PROVIDER_KIND_MISMATCH",
  "INVALID_CHRONOLOGY",
  "INVALID_RELIABILITY_METADATA",
  "INVALID_PAYLOAD",
  "SOURCE_UNKNOWN",
  "SOURCE_UNAVAILABLE",
  "STALE_INPUT",
  "TRUST_AS_OF_UNKNOWN",
  "SELECTION_MODE_MISMATCH",
  "SELECTION_SCOPE_MISMATCH",
  "SOURCE_RETURNED_NO_ADMITTED_OBSERVATION",
] as const satisfies readonly InformationAcquisitionOutcomeReasonV1[];

export type InformationAcquisitionOutcomeV1 = Readonly<{
  requestedSource: InformationRequestedSourceV1;
  status: "AVAILABLE" | "UNAVAILABLE" | "REJECTED";
  reasonCode: InformationAcquisitionOutcomeReasonV1 | null;
  canonicalPitAttempts: readonly PreparedCanonicalPitAttemptV1[];
  observationContentDigests: readonly string[];
}>;

export type InformationAcquisitionReceiptV1 = Readonly<{
  schemaVersion: typeof INFORMATION_ACQUISITION_RECEIPT_V1_SCHEMA_VERSION;
  selectionContentDigest: InformationAcquisitionSelectionV1["contentDigest"];
  mode: InformationAcquisitionSelectionV1["mode"];
  outcomes: readonly InformationAcquisitionOutcomeV1[];
  causalObservationContentDigests: readonly string[];
  authority: "EVIDENCE_ACQUISITION_ONLY";
  contentDigest: string;
}>;

export function defineInformationAcquisitionReceiptV1(input: {
  selection: InformationAcquisitionSelectionV1;
  outcomes: readonly InformationAcquisitionOutcomeV1[];
  observations: readonly NormalizedObservation[];
}): InformationAcquisitionReceiptV1 {
  const selection = assertInformationAcquisitionSelectionV1(input.selection);
  const observationsByDigest = new Map<
    string,
    Readonly<{ observation: NormalizedObservation; attempt: PreparedCanonicalPitAttemptV1 }>
  >();
  for (const observation of input.observations) {
    const attempt = prepareCanonicalPitAttemptV1(observation, {
      pitCutoffUtc: selection.pitAnchor,
    });
    if (observationsByDigest.has(attempt.normalizedInputDigest)) {
      throw new Error("INFORMATION_ACQUISITION_INVALID:duplicateObservationLineage");
    }
    observationsByDigest.set(attempt.normalizedInputDigest, { observation, attempt });
  }
  if (input.outcomes.length !== selection.requestedSources.length) {
    throw new Error("INFORMATION_ACQUISITION_INVALID:outcomeCoverage");
  }
  const outcomes = selection.requestedSources.map((requestedSource) => {
    const matches = input.outcomes.filter(
      (outcome) =>
        outcome.requestedSource.needId === requestedSource.needId &&
        outcome.requestedSource.providerId === requestedSource.providerId,
    );
    if (
      matches.length !== 1 ||
      inquiryCanonicalJsonString(matches[0]?.requestedSource) !==
        inquiryCanonicalJsonString(requestedSource)
    ) {
      throw new Error("INFORMATION_ACQUISITION_INVALID:outcomeSourceIdentity");
    }
    const outcome = matches[0]!;
    if (!(["AVAILABLE", "UNAVAILABLE", "REJECTED"] as const).includes(outcome.status)) {
      throw new Error("INFORMATION_ACQUISITION_INVALID:outcomeStatus");
    }
    if ((outcome.status === "AVAILABLE") !== (outcome.reasonCode === null)) {
      throw new Error("INFORMATION_ACQUISITION_INVALID:outcomeReason");
    }
    if (
      outcome.reasonCode !== null &&
      !(INFORMATION_ACQUISITION_OUTCOME_REASONS_V1 as readonly string[]).includes(
        outcome.reasonCode,
      )
    ) {
      throw new Error("INFORMATION_ACQUISITION_INVALID:outcomeReason");
    }
    const observationContentDigests = [...outcome.observationContentDigests].sort(
      inquiryCanonicalTextCompare,
    );
    if (
      new Set(observationContentDigests).size !== observationContentDigests.length ||
      observationContentDigests.some((digest) => !/^[0-9a-f]{64}$/.test(digest)) ||
      (outcome.status === "AVAILABLE") !== observationContentDigests.length > 0
    ) {
      throw new Error("INFORMATION_ACQUISITION_INVALID:observationContentDigests");
    }
    const canonicalPitAttempts = outcome.canonicalPitAttempts
      .map((attempt) => {
        const lineage = observationsByDigest.get(attempt.normalizedInputDigest);
        if (
          !lineage ||
          inquiryCanonicalJsonString(attempt) !== inquiryCanonicalJsonString(lineage.attempt)
        ) {
          throw new Error("INFORMATION_ACQUISITION_INVALID:attemptLineage");
        }
        return {
          gatewayKind: lineage.attempt.gatewayKind,
          providerId: lineage.attempt.providerId,
          normalizedInputDigest: lineage.attempt.normalizedInputDigest,
          status: lineage.attempt.status,
          reason: lineage.attempt.reason,
          kind: lineage.attempt.kind,
          source: lineage.attempt.source
            ? {
                providerId: lineage.attempt.source.providerId,
                venue: lineage.attempt.source.venue,
                feedKind: lineage.attempt.source.feedKind,
                symbol: lineage.attempt.source.symbol,
              }
            : null,
          subjectRef: lineage.attempt.subjectRef,
          payloadCanonical: lineage.attempt.payloadCanonical
            ? (JSON.parse(inquiryCanonicalJsonString(lineage.attempt.payloadCanonical)) as Record<
                string,
                unknown
              >)
            : null,
          eventTimeUtc: lineage.attempt.eventTimeUtc,
          availableAtUtc: lineage.attempt.availableAtUtc,
          ingestTimeUtc: lineage.attempt.ingestTimeUtc,
        };
      })
      .sort((left, right) =>
        inquiryCanonicalTextCompare(left.normalizedInputDigest, right.normalizedInputDigest),
      );
    const expectedObservationContentDigests = canonicalPitAttempts
      .filter((attempt) => attempt.status === "AVAILABLE")
      .map((attempt) => attempt.normalizedInputDigest);
    const expectedAttemptReason = canonicalPitAttempts[0]?.reason ?? null;
    if (
      new Set(canonicalPitAttempts.map((attempt) => attempt.normalizedInputDigest)).size !==
        canonicalPitAttempts.length ||
      canonicalPitAttempts.some(
        (attempt) =>
          attempt.providerId !== requestedSource.providerId ||
          (attempt.kind !== null &&
            !(requestedSource.allowedObservationKinds as readonly string[]).includes(attempt.kind)),
      ) ||
      (canonicalPitAttempts.length > 0 &&
        canonicalPitAttempts.some((attempt) => attempt.status !== outcome.status)) ||
      (outcome.status === "AVAILABLE" &&
        (canonicalPitAttempts.length === 0 ||
          inquiryCanonicalJsonString(expectedObservationContentDigests) !==
            inquiryCanonicalJsonString(observationContentDigests))) ||
      (outcome.status !== "AVAILABLE" &&
        canonicalPitAttempts.length > 0 &&
        outcome.reasonCode !== expectedAttemptReason)
    ) {
      throw new Error("INFORMATION_ACQUISITION_INVALID:canonicalPitAttempts");
    }
    return {
      requestedSource: {
        needId: requestedSource.needId,
        requirementId: requestedSource.requirementId,
        providerId: requestedSource.providerId,
        allowedObservationKinds: [...requestedSource.allowedObservationKinds],
        costUnits: requestedSource.costUnits,
        reasonCodes: [...requestedSource.reasonCodes],
      },
      status: outcome.status,
      reasonCode: outcome.reasonCode,
      canonicalPitAttempts,
      observationContentDigests,
    };
  });
  const causalObservationContentDigests = [
    ...new Set(outcomes.flatMap((outcome) => outcome.observationContentDigests)),
  ].sort(inquiryCanonicalTextCompare);
  const payload = {
    schemaVersion: INFORMATION_ACQUISITION_RECEIPT_V1_SCHEMA_VERSION,
    selectionContentDigest: selection.contentDigest,
    mode: selection.mode,
    outcomes,
    causalObservationContentDigests,
    authority: "EVIDENCE_ACQUISITION_ONLY" as const,
  };
  const digestPayload = {
    ...payload,
    outcomes: payload.outcomes.map((outcome) => ({
      requestedSource: outcome.requestedSource,
      status: outcome.status,
      reasonCode: outcome.reasonCode,
      canonicalPitAttempts: outcome.canonicalPitAttempts,
      observationContentDigests: outcome.observationContentDigests,
    })),
  };
  return deepFreezeInquiry({
    ...payload,
    contentDigest: computeInquiryContentDigest(digestPayload),
  });
}

export type BarReplayMode = "full" | "expand" | "wrap-expand" | "scenario-sequence";

export type MarketSnapshot = {
  bars: readonly Bar[];
  quote: Quote;
  evaluatedAt: string;
  cycleIndex: number;
  cycleId: string;
  /** When set, paper cycle dispatches only these registry strategy IDs (deterministic scenario replay). */
  activeStrategyIds?: readonly string[];
};

export type BarReplayNextResult = { done: false; snapshot: MarketSnapshot } | { done: true };

export type BarReplaySource = {
  next(): BarReplayNextResult;
  reset(): void;
};

export type BarPollSource = {
  fetchSnapshot(): Promise<MarketSnapshot>;
  reset(): void;
};

export type FixtureBarReplayOptions = {
  fixturePath?: string;
  mode?: BarReplayMode;
  cycleIdPrefix?: string;
};

export type HtxBarPollOptions = {
  internalSymbol?: InstrumentId;
  size?: number;
  period?: string;
  cycleIdPrefix?: string;
  restHost?: string;
  fetchImpl?: HtxFetchFn;
  /** When true, only HTX primary data is fetched (optional cross-exchange/sentiment omitted). */
  disableOptionalProviders?: boolean;
};

export type TraderFixtureFile = {
  bars: Bar[];
  latestQuote: Quote;
};
