import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { buildReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import { buildMarketUnderstandingBridge, buildExactMarketUnderstandingArtifactV1 } from "@/lib/trader/intelligence/market-understanding-bridge-v0";
import { evaluateInformationSufficiencyV2, type RequiredInformationProfileV2 } from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-v2";
import { bindInformationSufficiencyReceiptAuthorityV2 } from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-runtime-authority-v2";
import { copy, digest, seal, assertSeal, assertEnvironment, assertSession, type AnalysisPacket } from "../durable-noncapital/recorded-analysis-v1";
import { validateRecordedPacket, validateRecordedSourcePair } from "../durable-noncapital/recorded-source-read-validation-v1";
import { assertResearchAssignment, bounded, check, DECLARATIONS, LIMITS, RESEARCH_CONTRACT, type ResearchAssignment } from "./contract";
import { admitResearchLanes, type ResearchTrustRevision } from "./admission";

/** Fixed leaf composition. Public callers cannot supply an evaluator, evidence, receipt or output. */
export function evaluateSavedResearchUnderstanding(packet: AnalysisPacket, assignment: ResearchAssignment,
  profile: RequiredInformationProfileV2, revisions: readonly ResearchTrustRevision[]) {
  assertEnvironment(); assertSeal(packet); assertSession(packet.session); assertResearchAssignment(assignment, profile);
  bounded(packet, LIMITS.packet, "PACKET_LIMIT_EXCEEDED");
  check(packet.session.organizationId === assignment.organizationId && packet.session.accountId === assignment.accountId &&
    packet.session.symbol === assignment.symbol && packet.session.sessionId === assignment.sourceSessionId &&
    packet.session.configDigest === assignment.sourceConfigDigest && packet.sequence >= assignment.firstSourceSequence, "RESEARCH_PACKET_SCOPE_CONFLICT");
  let total = 0;
  for (const lane of Object.values(packet.normalized.captured.bars)) { check(lane.length <= LIMITS.barsPerLane, "BARS_LIMIT_EXCEEDED"); total += lane.length; }
  check(total <= LIMITS.barsTotal && packet.sources.length <= LIMITS.sourceCount, "INPUT_COUNT_LIMIT_EXCEEDED");
  validateRecordedPacket(packet.session, packet.sequence, { configDigest: packet.session.configDigest, analysisPitAnchor: packet.analysisPitAnchor }, packet);
  check(packet.sources.length === packet.normalized.observations.length, "SOURCE_SET_CONFLICT");
  packet.sources.forEach((source, index) => validateRecordedSourcePair(packet, index, source));
  const admitted = admitResearchLanes(packet, assignment, revisions);
  const normalized = packet.normalized;
  const features = computeFeatureSnapshot({ bars: normalized.bars["1m"]!, quote: normalized.quote, evaluatedAt: packet.analysisPitAnchor,
    newId: () => `research-feature:${digest({ assignment: assignment.contentDigest, packet: packet.contentDigest, computation: DECLARATIONS })}` });
  const reconstruction = buildReconstructionSnapshot({ bars1m: normalized.bars["1m"]!, evaluatedAt: packet.analysisPitAnchor, fusedContext: normalized.fusedContext });
  const bridge = buildMarketUnderstandingBridge({ features, reconstruction, fusedContext: normalized.fusedContext });
  const receipt = evaluateInformationSufficiencyV2({ profile, organizationId: assignment.organizationId, accountId: assignment.accountId,
    symbol: assignment.symbol, venue: "htx", analyticalTimeframe: "1m", horizon: profile.horizon, purpose: "RESEARCH_NON_CAPITAL",
    pitAnchor: packet.analysisPitAnchor, activeContextTriggers: [], evidence: admitted.evidence });
  const authority = bindInformationSufficiencyReceiptAuthorityV2(profile, receipt);
  check(authority.kind === "PROFILE_RECEIPT", "PROFILE_RECEIPT_AUTHORITY_REQUIRED");
  const artifact = buildExactMarketUnderstandingArtifactV1({ authority,
    organizationId: assignment.organizationId, accountId: assignment.accountId, symbol: assignment.symbol,
    analyticalTimeframe: "1m", evaluatedAt: packet.analysisPitAnchor, features, reconstruction, questionEvaluations: bridge.questionEvaluations });
  const what = bridge.questionEvaluations.find(q => q.questionId === "Q_WHAT_HAPPENING")!;
  const claim = artifact.claims.find(c => c.marketQuestionId === "Q_WHAT_HAPPENING")!;
  check(artifact.claims.length === 12, "INCOMPLETE_QUESTION_ARTIFACT");
  const disposition = receipt.status === "SUFFICIENT" && claim.claimState === "SUPPORTED" && what.status === "ANSWERED" && what.answerSummary !== "UNCLEAR"
    ? "COMPLETED_SUPPORTED" as const : "COMPLETED_UNRESOLVED" as const;
  check(disposition !== "COMPLETED_SUPPORTED" || admitted.lanes.every(lane => lane.evidenceId !== null), "POSITIVE_LANE_MISSING");
  const result = seal({ schemaVersion: RESEARCH_CONTRACT, packetDigest: packet.contentDigest, assignmentDigest: assignment.contentDigest,
    declarations: DECLARATIONS, analysisPitAnchor: packet.analysisPitAnchor, disposition, features, reconstruction,
    questionEvaluations: bridge.questionEvaluations, receipt, artifact, lanes: admitted.lanes,
    inputs: { capturedDigest: digest(normalized.captured), normalizedDigest: digest(normalized), sourcesDigest: digest(packet.sources),
      selectedRevisionsDigest: digest(revisions), fullPacketDigest: packet.contentDigest },
    attribution: { supportedQuestion: "Q_WHAT_HAPPENING", requiredLanes: ["1m", "4h"],
      retainedNonSupportingInputs: ["15m", "1h", "1d", "quote", "book", "trades"], absentOptionalContext: true,
      contradictionAssessment: "EXACT_RECORDED_IDENTITY_CONSISTENCY_ONLY" } });
  bounded(result, LIMITS.completion, "COMPLETION_LIMIT_EXCEEDED"); bounded(receipt, LIMITS.informationReceipt, "RECEIPT_LIMIT_EXCEEDED");
  return copy(result);
}
export type ResearchEvaluation = ReturnType<typeof evaluateSavedResearchUnderstanding>;
