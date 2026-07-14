export {
  DEFAULT_CYCLE_ID_PREFIX,
  DEFAULT_GOLDEN_FIXTURE_PATH,
  EXPAND_MIN_BARS,
  FixtureBarReplaySource,
} from "@/lib/trader/market-data/fixture-bar-replay-source";
export {
  HistoricalBarSource,
  type HistoricalBarSourceOptions,
} from "@/lib/trader/market-data/historical-bar-source";
export {
  DEFAULT_HTX_KLINE_PERIOD,
  DEFAULT_HTX_KLINE_SIZE,
  DEFAULT_HTX_POLL_CYCLE_ID_PREFIX,
  HtxBarPollSource,
} from "@/lib/trader/market-data/htx-bar-poll-source";
export { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
export {
  insertMarketBarsPostgres,
  listMarketBarsPostgres,
  type InsertMarketBarInput,
  type ListMarketBarsQuery,
  type MarketBarRecord,
} from "@/lib/trader/market-data/market-bars-repository-postgres";
export {
  insertResearchDatasetPostgres,
  getResearchDatasetByIdPostgres,
  type ResearchDatasetRecord,
} from "@/lib/trader/market-data/research-dataset-repository-postgres";
export {
  computeBarSetDigest,
  sealResearchDataset,
  splitBarsThreeWay,
} from "@/lib/trader/market-data/research-dataset";
export type {
  BarPollSource,
  BarReplayMode,
  BarReplayNextResult,
  BarReplaySource,
  FixtureBarReplayOptions,
  HtxBarPollOptions,
  MarketSnapshot,
  TraderFixtureFile,
} from "@/lib/trader/market-data/types";
export {
  FUSED_CONTEXT_SCHEMA_VERSION,
  HTX_PERIOD_BY_INTERVAL,
  INTERVAL_BY_HTX_PERIOD,
  MARKET_DATA_PROVIDER_IDS,
  MTF_BAR_INTERVALS,
  OBSERVATION_SCHEMA_VERSION,
  type AsianRangeCorridorMetadata,
  type FusedMarketContext,
  type MarketDataProviderId,
  type NormalizedObservation,
  type NormalizedObservationKind,
  type ProviderHealth,
  type SessionPhase,
  type SourceProvenanceRef,
} from "@/lib/trader/market-data/observation-types";
export {
  getMarketDataProvider,
  isRegisteredMarketDataProvider,
  listMarketDataProviders,
} from "@/lib/trader/market-data/provider-registry";
export {
  MarketDataGateway,
  type GatewayPollResult,
  type MarketDataGatewayConfig,
} from "@/lib/trader/market-data/market-data-gateway";
export { fuseContextV0 } from "@/lib/trader/market-data/fusion/context-fusion-v0";
export {
  fuseContextV1,
  type FuseContextV1Input,
} from "@/lib/trader/market-data/fusion/context-fusion-v1";
export { classifySessionPhaseUtc } from "@/lib/trader/market-data/session/session-phase-classifier";
export { computeAsianRangeCorridorMetadata } from "@/lib/trader/market-data/session/asian-range-corridor";
export {
  detectGap,
  validateOhlcv,
  validateTimestamps,
} from "@/lib/trader/market-data/canvas/market-canvas";
export {
  REPLAY_PROVIDER_SIDECAR_V3,
  type ReplayProviderSidecarLaneKey,
  type ReplayProviderSidecarTimelineEntryV3,
  type ReplayProviderSidecarV3,
} from "@/lib/trader/market-data/replay/provider-sidecar-types";
export {
  assertNoNetworkImport,
  buildHistoricalIngressContext,
  HTR_WP11_FABRICATED_AVAILABILITY,
  HTR_WP11_FUTURE_EVIDENCE_REACHABLE,
  HTR_WP11_INGRESS_BYPASS,
  HTR_WP11_LIVE_PROVIDER_CALL_FORBIDDEN,
  HTR_WP11_STRATEGY_DIRECT_PROVIDER_IMPORT,
  type HistoricalIngressInput,
  type HistoricalIngressResult,
} from "@/lib/trader/market-data/replay/historical-ingress-gateway";
