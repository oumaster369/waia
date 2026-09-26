import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { copy, digest, assertEnvironment, assertSeal, assertSession, seal, requireCondition,
  ANALYSIS_CONTRACT, type AnalysisPacket, type AnalysisOutput } from "./recorded-analysis-v1";
import { normalizeMandatory } from "./normalize-mandatory-packet-v1";

/** The sole evaluator for this namespace. No caller output, callback, profile or authority override. */
export function evaluateRecordedAnalysis(packet: AnalysisPacket): AnalysisOutput {
  assertEnvironment(); assertSeal(packet); assertSession(packet.session);
  const normalized = normalizeMandatory(packet.normalized.captured, packet.session, packet.analysisPitAnchor);
  requireCondition(digest(normalized) === digest(packet.normalized), "NORMALIZATION_CONTENT_CONFLICT");
  requireCondition(digest(packet.previousState) === packet.previousStateDigest, "PREDECESSOR_CONFLICT");
  const ids: string[] = [];
  const evaluation = runEvaluationCycle({ organizationId: packet.session.organizationId, accountId: packet.session.accountId,
    symbol: packet.session.symbol, bars: normalized.bars["1m"]!, quote: normalized.quote,
    fusedContext: normalized.fusedContext, evaluatedAt: packet.analysisPitAnchor,
    miCoreEnabled: true, omitIntelligenceArtifacts: false, hypothesisSessionState: copy(packet.previousState),
    strategySignalIds: packet.session.registry.map(entry => entry.strategyId),
    newId: () => { const id = `recorded-analysis:${digest({ packet: packet.contentDigest, contract: ANALYSIS_CONTRACT,
      predecessor: packet.previousStateDigest, ordinal: ids.length })}`; ids.push(id); return id; } });
  requireCondition(!evaluation.understandingArtifact && !evaluation.canonicalRuntimeIntelligenceState &&
    !evaluation.intelligenceCycleBundle && !evaluation.forecastDecisionBundle, "UNEXPECTED_ANALYTICAL_AUTHORITY");
  requireCondition(evaluation.hypothesisSessionState, "MISSING_NEXT_STATE");
  return seal({ schemaVersion: ANALYSIS_CONTRACT, packetDigest: packet.contentDigest, evaluation: copy(evaluation),
    nextState: copy(evaluation.hypothesisSessionState), nextStateDigest: digest(evaluation.hypothesisSessionState),
    idCount: ids.length, idsDigest: digest(ids), authority: "OBSERVATIONAL_ONLY" as const });
}
