import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";

export const M9_DECISION_TRACE_SCHEMA_VERSION = "m9_decision_trace_v1" as const;

export type M9DecisionTraceCycle = {
  evaluatedAt: string;
  fused: {
    aggregateHealth: string;
    aggregateConfidence: number;
    providerCoverageScore: number;
    degradationReasons: readonly string[];
    provenanceProviderIds: readonly string[];
  } | null;
  understanding: {
    regimeHint: string;
    spotPosture: string;
    postureRationale: string;
    crossVenueAgreement: string;
    understandingConfidence: number;
    knowledgeGapReasonCodes: readonly string[];
    evidenceUsed: readonly string[];
    evidenceIgnored: readonly string[];
    confidenceContributors: readonly string[];
  } | null;
  msv: {
    regime: string;
    tradingPermission: string;
    riskMultiplier: string;
    reasonCodes: readonly string[];
    allowedStrategyIds: readonly string[];
    newsSentiment: string | null;
  };
  selected: {
    strategyId: string;
    outcome: string;
    side: string | null;
  };
};

export type M9DecisionTraceExport = {
  schemaVersion: typeof M9_DECISION_TRACE_SCHEMA_VERSION;
  generatedAt: string;
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  cycleCount: number;
  cycles: M9DecisionTraceCycle[];
  contentDigest: string;
};

function provenanceProviderIds(fused: NonNullable<PaperCycleResult["evaluation"]["fusedContext"]>) {
  const ids = new Set<string>();
  const all = [
    ...Object.values(fused.mtfBars).flat(),
    fused.primaryQuote,
    fused.orderBookSnapshot,
    fused.marketTradesSnapshot,
    fused.crossExchangeConfirmation,
    fused.fearGreed,
    fused.globalMarket,
    ...(fused.macroEvidence ?? []),
    ...(fused.newsEvidence ?? []),
    ...(fused.blockchainEvidence ?? []),
    ...(fused.regulatoryEvidence ?? []),
    ...(fused.protocolEvidence ?? []),
  ].filter((obs): obs is NonNullable<typeof obs> => obs !== undefined);
  for (const obs of all) {
    ids.add(obs.provenance.providerId);
  }
  return [...ids].sort();
}

export function computeDecisionTraceContentDigest(
  exportDoc: Omit<M9DecisionTraceExport, "contentDigest">,
): string {
  return createHash("sha256").update(canonicalJsonString(exportDoc), "utf8").digest("hex");
}

export function buildM9DecisionTraceExport(input: {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  cycleResults: readonly PaperCycleResult[];
  maxSamples?: number;
  generatedAt?: string;
}): M9DecisionTraceExport {
  const maxSamples = input.maxSamples ?? 25;
  const cycles: M9DecisionTraceCycle[] = [];

  for (const cycle of input.cycleResults) {
    if (cycles.length >= maxSamples) {
      break;
    }
    const evaluation = cycle.evaluation;
    const fused = evaluation.fusedContext;
    const understanding = evaluation.understanding;
    const primarySignal = evaluation.signal;

    cycles.push({
      evaluatedAt: evaluation.features.evaluatedAt,
      fused: fused
        ? {
            aggregateHealth: fused.aggregateHealth,
            aggregateConfidence: fused.aggregateConfidence,
            providerCoverageScore: fused.aggregateConfidence,
            degradationReasons: fused.degradationReasons,
            provenanceProviderIds: provenanceProviderIds(fused),
          }
        : null,
      understanding: understanding
        ? {
            regimeHint: understanding.regimeHint,
            spotPosture: understanding.spotPosture,
            postureRationale: understanding.postureRationale.join(" | "),
            crossVenueAgreement: understanding.crossVenue.agreement,
            understandingConfidence: understanding.understandingConfidence,
            knowledgeGapReasonCodes: understanding.knowledgeGaps.map((gap) => gap.reasonCode),
            evidenceUsed: understanding.reasoningInputs.evidenceUsed,
            evidenceIgnored: understanding.reasoningInputs.evidenceIgnored,
            confidenceContributors: understanding.confidenceAttribution.contributors.map(
              (entry) => `${entry.source}:${entry.magnitude}`,
            ),
          }
        : null,
      msv: {
        regime: evaluation.msv.derived.regime,
        tradingPermission: evaluation.msv.derived.tradingPermission,
        riskMultiplier: evaluation.msv.derived.riskMultiplier,
        reasonCodes: evaluation.msv.derived.reasonCodes,
        allowedStrategyIds: evaluation.msv.derived.allowedStrategyIds,
        newsSentiment: evaluation.msv.crowd.newsSentiment,
      },
      selected: {
        strategyId: primarySignal.strategyId,
        outcome: primarySignal.outcome,
        side: primarySignal.side ?? null,
      },
    });
  }

  const withoutDigest: Omit<M9DecisionTraceExport, "contentDigest"> = {
    schemaVersion: M9_DECISION_TRACE_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    organizationId: input.organizationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    cycleCount: cycles.length,
    cycles,
  };

  return {
    ...withoutDigest,
    contentDigest: computeDecisionTraceContentDigest(withoutDigest),
  };
}
