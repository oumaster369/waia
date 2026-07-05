import type {
  DescriptiveEventRef,
  DescriptivePatternRef,
  ResearchCampaignRef,
} from "@/lib/trader/discovery/discovery.types";
import type { Bar } from "@/lib/trader/intelligence/types";
import type { PaperClosedTrade } from "@/lib/trader/paper/paper-strategy-eval.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export const OBSERVATION_SCHEMA_VERSION = "waia.trader.discovery-observation.v1" as const;

export type ObservationBarWindow = {
  symbol: string;
  interval: string;
  start: string;
  end: string;
  barCount: number;
};

export type ObservationTradeRef = {
  fillId: string;
  symbol: string;
  executedAt: string;
  /** Structural fact only — not used as fitness signal. */
  regimeLabel: string | null;
};

export type ObservationRecord = {
  schemaVersion: typeof OBSERVATION_SCHEMA_VERSION;
  observationId: string;
  campaignRef: ResearchCampaignRef;
  barWindow: ObservationBarWindow;
  observedRegimes: readonly string[];
  tradeRefs: readonly ObservationTradeRef[];
  patternRefs: readonly DescriptivePatternRef[];
  eventRefs: readonly DescriptiveEventRef[];
  contentDigest: string;
  createdAt: string;
};

export type ObservationSynthesizerInput = {
  campaignRef: ResearchCampaignRef;
  context: OrgContext;
  barWindow: { symbol: string; start: string; end: string };
  bars: readonly Bar[];
  closedTrades: readonly PaperClosedTrade[];
  patternObservations?: readonly DescriptivePatternRef[];
  eventObservations?: readonly DescriptiveEventRef[];
  resolveRegimeForTrade?: (trade: PaperClosedTrade, bars: readonly Bar[]) => string | null;
};
