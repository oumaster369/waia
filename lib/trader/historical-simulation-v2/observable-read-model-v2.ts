import type { HistoricalSimulationRunLifecycleProjectionV2 } from
  "./run-lifecycle-v2";

export const HISTORICAL_OBSERVABLE_READ_MODEL_V2 =
  "waia.trader.historical_observable_read_model.v2" as const;

export type HistoricalObservableScopeV2 = Readonly<{
  organizationId: string;
  runId: string;
  accountId?: string;
}>;

export type HistoricalObservableCycleV2 = Readonly<{
  accountId: string;
  cycleSequence: number;
  cycleId: string;
  symbol: string;
  partition: "DEVELOPMENT" | "WALK_FORWARD";
  replayBarClosedAtUtc: string;
  cash: string | null;
  equity: string | null;
  netPnl: string | null;
  grossRealizedPnl: string | null;
  netRealizedPnl: string | null;
  netUnrealizedPnl: string | null;
  buyAndHoldGrossEquity: string | null;
  strategyMinusBuyAndHoldGross: string | null;
  buyAndHoldConvention: "GROSS_MARK_TO_MARKET_NO_FEES";
  openPositionsCount: number;
  decisionsCount: number;
  riskVetoCount: number;
  ordersCount: number;
  fillsCount: number;
  lastForecast: unknown;
  lastDecision: unknown;
  lastPortfolio: unknown;
  lastRisk: unknown;
  lastExecution: unknown;
  lastAccounting: unknown;
  lastGuardian: unknown;
  lastLearning: unknown;
  observedExecutionEffects: readonly unknown[];
  modeledRealityArtifacts: readonly unknown[];
  knowledgeArtifacts: readonly unknown[];
  stages: readonly string[];
  snapshots: readonly string[];
  checkpoint: Readonly<{
    committedCycleSequence: number;
    nextRecordIndex: number;
    nextCycleSequence: number;
    contentDigestHex: string;
  }> | null;
  ledgerHeadContentDigestHex: string;
}>;

export type HistoricalObservableAccountV2 = HistoricalObservableCycleV2 & Readonly<{
  /** Complete, ordered, durable reason journal for every committed cycle. */
  history: readonly HistoricalObservableCycleV2[];
}>;

export type HistoricalObservableProjectionV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_OBSERVABLE_READ_MODEL_V2;
  mode: "HISTORICAL_SIMULATION";
  capitalEligible: false;
  organizationId: string;
  runId: string;
  eventId: string;
  observedAt: string;
  lifecycle: HistoricalSimulationRunLifecycleProjectionV2 | null;
  accounts: readonly HistoricalObservableAccountV2[];
  aggregate: Readonly<{
    accountCount: number;
    equity: string | null;
    cash: string | null;
    netPnl: string | null;
    buyAndHoldGrossEquity: string | null;
    strategyMinusBuyAndHoldGross: string | null;
    cycles: number;
    decisions: number;
    riskVetoes: number;
    orders: number;
    fills: number;
    processedRecords: number;
    latestCycleSequence: number | null;
    qualifiedTotalCycles: number | null;
    committedCycles: number;
    progressBps: number | null;
    runPhase: HistoricalSimulationRunLifecycleProjectionV2["phase"] | null;
  }>;
}>;
