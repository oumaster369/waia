import type {
  ForecastDecisionBundle,
  TraderIntelligenceDecisionForecastLink,
  TraderIntelligenceDecisionRecord,
  TraderIntelligenceEntryPurposeRecord,
  TraderIntelligenceForecastRecord,
} from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type ForecastRecordRepository = {
  findByBusinessKey(
    context: OrgContext,
    key: {
      runId: string;
      cycleId: string;
      symbol: string;
      forecastKeyDigest: string;
    },
  ): Promise<TraderIntelligenceForecastRecord | null>;
  insert(context: OrgContext, record: TraderIntelligenceForecastRecord): Promise<void>;
};

export type DecisionRecordRepository = {
  findByBusinessKey(
    context: OrgContext,
    key: { runId: string; cycleId: string; symbol: string },
  ): Promise<TraderIntelligenceDecisionRecord | null>;
  insert(context: OrgContext, record: TraderIntelligenceDecisionRecord): Promise<void>;
};

export type DecisionForecastLinkRepository = {
  findByBusinessKey(
    context: OrgContext,
    key: { decisionRecordId: string; forecastRecordId: string },
  ): Promise<TraderIntelligenceDecisionForecastLink | null>;
  insert(context: OrgContext, record: TraderIntelligenceDecisionForecastLink): Promise<void>;
};

export type EntryPurposeRecordRepository = {
  findByBusinessKey(
    context: OrgContext,
    key: { runId: string; cycleId: string; symbol: string },
  ): Promise<TraderIntelligenceEntryPurposeRecord | null>;
  insert(context: OrgContext, record: TraderIntelligenceEntryPurposeRecord): Promise<void>;
};

export type ForecastDecisionBundleRepository = {
  persist(context: OrgContext, bundle: ForecastDecisionBundle): Promise<ForecastDecisionBundle>;
};

export type ForecastDecisionRuntime = {
  forecastRecordRepository: ForecastRecordRepository;
  decisionRecordRepository: DecisionRecordRepository;
  decisionForecastLinkRepository: DecisionForecastLinkRepository;
  entryPurposeRecordRepository: EntryPurposeRecordRepository;
};
