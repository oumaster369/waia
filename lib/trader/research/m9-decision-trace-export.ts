import { computeReplayReproContentDigest } from "@/lib/trader/research/replay-repro-digest";
import type { StreamingEvidenceReader } from "@/lib/trader/backtest/streaming-evidence";
import {
  assertM9ProjectionSource,
  countM9InputCycles,
  iterateM9Cycles,
} from "@/lib/trader/research/m9-projection-source";
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
    conviction?: number;
    opportunityAuthorized?: boolean;
    activeHypothesisType?: string | null;
    eligibleStrategyFamilies?: readonly string[];
  };
  selected: {
    strategyId: string;
    outcome: string;
    side: string | null;
  };
  /** PR-2 MI Core: decision-chain completeness fields. */
  decisionChain?: {
    terminalReasonCode: string;
    opportunityAuthorized: boolean;
    activeHypothesisType: string | null;
    reconstructionSummary: string;
    observation: {
      expectedPath: string;
      observedOutcome: string;
      deviation: string;
      invalidationStatus: string;
      terminalReasonCode: string;
    };
  } | null;
};

export type M9DecisionTraceExport = {
  schemaVersion: typeof M9_DECISION_TRACE_SCHEMA_VERSION;
  generatedAt: string;
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  cycleCount: number;
  /** Total cycles in input (100% completeness denominator). */
  totalInputCycles: number;
  /** Completeness record covers all input cycles (no sampling cap). */
  completenessCoverage: "full" | "sampled";
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

/**
 * Content digest excluding `generatedAt` (identity/provenance, not content — DEE-397 /
 * ADR-0021), so two replays over identical inputs produce an identical digest.
 */
export function computeDecisionTraceContentDigest(
  exportDoc: Omit<M9DecisionTraceExport, "contentDigest">,
): string {
  return computeReplayReproContentDigest(exportDoc);
}

export function buildM9DecisionTraceExport(input: {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  cycleResults?: readonly PaperCycleResult[];
  projectionReader?: StreamingEvidenceReader;
  maxSamples?: number;
  generatedAt?: string;
}): M9DecisionTraceExport {
  assertM9ProjectionSource(input);
  const maxSamples = input.maxSamples ?? 25;
  const completenessCycles: M9DecisionTraceCycle[] = [];
  const sampleCycles: M9DecisionTraceCycle[] = [];

  for (const cycle of iterateM9Cycles(input)) {
    const evaluation = cycle.evaluation;
    const fused = evaluation.fusedContext;
    const understanding = evaluation.understanding;
    const primarySignal = evaluation.signal;
    const decisionChain = evaluation.decisionChain;

    const traceCycle: M9DecisionTraceCycle = {
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
        conviction: evaluation.msv.derived.conviction,
        opportunityAuthorized: evaluation.msv.derived.opportunityAuthorized,
        activeHypothesisType: evaluation.msv.derived.activeHypothesisType,
        eligibleStrategyFamilies: evaluation.msv.derived.eligibleStrategyFamilies,
      },
      selected: {
        strategyId: primarySignal.strategyId,
        outcome: primarySignal.outcome,
        side: primarySignal.side ?? null,
      },
      decisionChain: decisionChain
        ? {
            terminalReasonCode: decisionChain.terminalReasonCode,
            opportunityAuthorized: decisionChain.opportunityAuthorized,
            activeHypothesisType: decisionChain.activeHypothesisType,
            reconstructionSummary: decisionChain.reconstructionSummary,
            observation: {
              expectedPath: decisionChain.observation.expectedPath,
              observedOutcome: decisionChain.observation.observedOutcome,
              deviation: decisionChain.observation.deviation,
              invalidationStatus: decisionChain.observation.invalidationStatus,
              terminalReasonCode: decisionChain.observation.terminalReasonCode,
            },
          }
        : null,
    };

    completenessCycles.push(traceCycle);
    if (sampleCycles.length < maxSamples) {
      sampleCycles.push(traceCycle);
    }
  }

  const hasDecisionChains = completenessCycles.some((c) => c.decisionChain !== null);
  const cycles = hasDecisionChains ? completenessCycles : sampleCycles;

  const withoutDigest: Omit<M9DecisionTraceExport, "contentDigest"> = {
    schemaVersion: M9_DECISION_TRACE_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    organizationId: input.organizationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    cycleCount: cycles.length,
    totalInputCycles: countM9InputCycles(input),
    completenessCoverage: hasDecisionChains ? "full" : "sampled",
    cycles,
  };

  return {
    ...withoutDigest,
    contentDigest: computeDecisionTraceContentDigest(withoutDigest),
  };
}
