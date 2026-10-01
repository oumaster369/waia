import { createHtrHistoricalCostModelAuthorityV1 } from "@/lib/trader/execution/cost-model";
import {
  RESEARCH_EXECUTABLE_ID_V1,
  RESEARCH_EXPERIMENT_SCHEMA_V1,
} from "@/lib/trader/research/research-experiment-contract-v1";

const digest = (character: string) => character.repeat(64);
const partition = (contentSha256: string, firstOpenMs: number, lastCloseMs: number) => ({
  contentSha256,
  firstOpenMs,
  lastCloseMs,
  barCount: 10,
});

/** Synthetic, proposal-only fixture shared by DEE-1159 Postgres tests. */
export function buildResearchExperimentProposalV1(organizationId: string, marker: string) {
  const authority = createHtrHistoricalCostModelAuthorityV1();
  return {
    schemaVersion: RESEARCH_EXPERIMENT_SCHEMA_V1,
    organizationId,
    hypothesis: {
      observationEvidenceSha256: [digest("a"), digest("b")],
      observationCutoffMs: 99,
      mechanism: `A falsifiable synthetic mechanism: ${marker}`,
      falsificationRule: "Reject if the preregistered condition is absent.",
    },
    executable: {
      id: RESEARCH_EXECUTABLE_ID_V1,
      sourceSha256: digest("c"),
      featureSemantics: "closed-prefix-sma-population-zscore/v1",
      replaySemantics: "htr-next-eligible-closed-bar-close-with-retained-evaluation-prefix/v1",
    },
    orderedTrials: [
      { lookbackBars: 8, buyZscore: "-1.5", sellZscore: "0" },
      { lookbackBars: 16, buyZscore: "-1.5", sellZscore: "0" },
      { lookbackBars: 32, buyZscore: "-1.5", sellZscore: "0" },
    ],
    universe: {
      venue: "HTX",
      market: "SPOT",
      symbol: "BTCUSDT",
      interval: "1m",
      pointInTimeEvidenceSha256: digest("d"),
      knownAtMs: 100,
      datasetSourceSha256: digest("e"),
      sidecarContentSha256: null,
    },
    partitions: {
      train: partition(digest("1"), 100, 200),
      validation: partition(digest("2"), 200, 300),
      blind: partition(digest("3"), 300, 400),
      walkForward: [partition(digest("4"), 210, 240), partition(digest("5"), 250, 280)],
    },
    costs: {
      modelId: authority.modelId,
      schemaVersion: authority.schemaVersion,
      feeBps: authority.feeBps,
      halfSpreadBps: authority.halfSpreadBps,
      marketImpactBps: authority.marketImpactBps,
      slippageModel: authority.slippageModel,
      takerFeeBps: authority.takerFeeBps,
      makerFeeBps: authority.makerFeeBps,
      submitLatencyMs: authority.submitLatencyMs,
      cancelLatencyMs: authority.cancelLatencyMs,
      partialFillModel: authority.partialFillModel,
      costModelDigest: authority.costModelDigest,
    },
    replay: {
      executionMode: "mock",
      submitResearchMockOrders: true,
      enableReplayFusedContext: false,
      retentionMode: "FULL",
      partialRunEvidence: "ineligible",
      metricsSchemaVersion: "2.0.0",
      defaultQuantity: "0.01",
      accountKey: "proposal-only-account",
      portfolio: {
        startingBalanceUsdt: "10000",
        maxRiskPerTradePct: "1",
        maxPortfolioRiskPct: "3",
        maxConcurrentPositions: 1,
        maxNotional: "10000",
        defaultStopDistancePct: null,
      },
      guardian: {
        enabled: false,
        maxHoldBars: 0,
        barIntervalMs: 60_000,
        enableExitEngine: false,
        htrAuthoritative: true,
        resolvedPolicySha256: digest("8"),
      },
      historicalExecutionModelSha256: digest("6"),
      intelligenceProfileSha256: null,
      volumeQualificationSha256: digest("7"),
    },
    selection: {
      objective: "train-after-cost-realized-pnl",
      tieBreak: "first-in-declared-family",
      validationSelection: "forbidden",
      blindSelection: "forbidden",
    },
  };
}
