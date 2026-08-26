import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { buildForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-service";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { buildCanonicalRuntimeIntelligenceStateV1 } from "@/lib/trader/intelligence/hypothesis/runtime-knowledge-authority-v1";
import { declareResearchNonCapitalInformationAuthorityV2 } from "@/lib/trader/intelligence/information-sufficiency";
import { buildIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records-service";
import type {
  KnowledgeEdge,
  MarketEvent,
  MarketPrediction,
} from "@/lib/trader/knowledge/knowledge.types";
import type { MkbReadModelSnapshot } from "@/lib/trader/knowledge/mkb-read-model.types";
import { createDeterministicReplayIdFactory } from "@/lib/trader/research/deterministic-replay-id-factory";
import { wp14Bars } from "./wp14-test-helpers";

export function buildWp15KnowledgeSeedArtifacts(organizationId: string): {
  marketPredictions: MarketPrediction[];
  marketEvents: MarketEvent[];
  knowledgeEdges: KnowledgeEdge[];
} {
  return {
    marketPredictions: [
      {
        id: "00000000-0000-4000-8000-000000041501",
        organizationId,
        subjectRef: "legacy:prediction:btc",
        predictionJson: JSON.stringify({ direction: "up" }),
        predictedAt: new Date(Date.UTC(2024, 0, 1, 12, 0, 0)),
        outcomeJson: null,
        verifiedAt: null,
        verificationResult: null,
        contentDigest: "a".repeat(64),
        createdAt: new Date(Date.UTC(2024, 0, 1, 12, 0, 0)),
      },
    ],
    marketEvents: [
      {
        id: "00000000-0000-4000-8000-000000041502",
        organizationId,
        eventKind: "pattern_detected",
        subjectRef: "BTC/USDT",
        payloadJson: JSON.stringify({ patternKey: "double_bottom" }),
        eventTime: new Date(Date.UTC(2024, 0, 1, 13, 0, 0)),
        confidence: "0.7000",
        contentDigest: "b".repeat(64),
        createdAt: new Date(Date.UTC(2024, 0, 1, 13, 0, 0)),
      },
    ],
    knowledgeEdges: [
      {
        id: "00000000-0000-4000-8000-000000041503",
        organizationId,
        fromRef: "pattern:double_bottom@digest",
        toRef: "close:order:sample",
        relationKind: "pattern_associated_with_close",
        confidence: "0.7500",
        strength: "0.6000",
        regimeScope: "trend_up",
        failureCasesJson: "[]",
        hypothesisId: null,
        verified: true,
        createdAt: new Date(Date.UTC(2024, 0, 1, 14, 0, 0)),
        updatedAt: new Date(Date.UTC(2024, 0, 1, 14, 0, 0)),
      },
    ],
  };
}

export function buildWp15Snapshot(
  organizationId: string,
  runId: string,
  cycleId: string,
): MkbReadModelSnapshot {
  const bars = wp14Bars();
  const pitAnchor = bars.at(-1)!.barCloseTime;
  const informationSufficiencyAuthority = declareResearchNonCapitalInformationAuthorityV2({
    organizationId,
    reason: "HTR_WP15_UNIT_TEST",
  });
  const cycle = runEvaluationCycle({
    organizationId,
    bars,
    historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
    runId,
    cycleId,
    newId: createDeterministicReplayIdFactory(415_150),
    costModel: createCostModelV1("10", "5"),
    informationSufficiencyAuthority,
    canonicalRuntimeIntelligenceState: buildCanonicalRuntimeIntelligenceStateV1({
      organizationId,
      symbol: "BTC/USDT",
      pitAnchor,
      knowledgeSemanticDigest: "wp15-canonical-knowledge-fixture-v1",
      hypotheses: [{
        hypothesisId: `${runId}:${cycleId}:canonical-hypothesis`,
        hypothesisKey: "wp15-canonical-trend-continuation",
        definitionDigest: "wp15-canonical-definition-v1",
        createdAt: pitAnchor,
        hypothesisType: "trend_continuation",
        lifecycleState: "VALIDATED",
        rankOrdinal: 0,
        ordinalJudgment: "SUPPORTED",
        expectedPath: "continuation",
        invalidationConditions: ["structure_break"],
        supportingEvidence: [],
        contradictingEvidence: [],
        knowledgeRefs: [{
          knowledgeEdgeId: "00000000-0000-4000-8000-000000041503",
          knowledgeState: "RESOLVED_CORRECT",
        }],
        supersedesHypothesisIds: [],
      }],
    }),
  });

  const intelligenceCycleBundle = buildIntelligenceCycleBundle({
    organizationId,
    runId,
    cycleId,
    symbol: "BTC/USDT",
    accountId: null,
    analyticalTimeframe: bars[0]!.interval,
    marketStateSnapshot: cycle.marketStateSnapshot!,
    decisionChain: cycle.decisionChain!,
  });

  const forecastDecisionBundle = buildForecastDecisionBundle({
    intelligenceCycleBundle,
    hypothesisSet: cycle.hypothesisSet!,
    decisionChain: cycle.decisionChain!,
    msv: cycle.msv,
    signal: cycle.signal,
    costModel: createCostModelV1("10", "5"),
    informationSufficiencyAuthority,
  });

  const knowledgeSeed = buildWp15KnowledgeSeedArtifacts(organizationId);

  return {
    cycleEnvelopes: [intelligenceCycleBundle.envelope],
    hypotheses: [...intelligenceCycleBundle.hypotheses],
    convictions: [intelligenceCycleBundle.conviction],
    forecasts: [...forecastDecisionBundle.forecasts],
    decisions: [forecastDecisionBundle.decision],
    links: [...forecastDecisionBundle.links],
    entryPurposes: forecastDecisionBundle.entryPurpose ? [forecastDecisionBundle.entryPurpose] : [],
    knowledgeEdges: knowledgeSeed.knowledgeEdges,
    marketPredictions: knowledgeSeed.marketPredictions,
    marketEvents: knowledgeSeed.marketEvents,
  };
}

export const WP15_ORG_A = "00000000-0000-4000-8000-000000041501";
export const WP15_ORG_B = "00000000-0000-4000-8000-000000041502";

export const WP15_AS_OF = new Date(Date.UTC(2024, 0, 2, 0, 0, 0));
