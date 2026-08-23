import type {
  ForecastDecisionBundle,
  TraderIntelligenceDecisionForecastLink,
  TraderIntelligenceDecisionRecord,
  TraderIntelligenceEntryPurposeRecord,
  TraderIntelligenceForecastRecord,
} from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type { InformationSufficiencyRuntimeAuthorityV2 } from "@/lib/trader/intelligence/information-sufficiency";
import type { ForecastDecisionPersistencePermit } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-construction-authority";

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
  insert(
    context: OrgContext,
    record: TraderIntelligenceForecastRecord,
    permit: ForecastDecisionPersistencePermit,
  ): Promise<void>;
};

export type DecisionRecordRepository = {
  findByBusinessKey(
    context: OrgContext,
    key: { runId: string; cycleId: string; symbol: string },
  ): Promise<TraderIntelligenceDecisionRecord | null>;
  insert(
    context: OrgContext,
    record: TraderIntelligenceDecisionRecord,
    permit: ForecastDecisionPersistencePermit,
  ): Promise<void>;
};

export type DecisionForecastLinkRepository = {
  findByBusinessKey(
    context: OrgContext,
    key: { decisionRecordId: string; forecastRecordId: string },
  ): Promise<TraderIntelligenceDecisionForecastLink | null>;
  insert(
    context: OrgContext,
    record: TraderIntelligenceDecisionForecastLink,
    permit: ForecastDecisionPersistencePermit,
  ): Promise<void>;
};

export type EntryPurposeRecordRepository = {
  findByBusinessKey(
    context: OrgContext,
    key: { runId: string; cycleId: string; symbol: string },
  ): Promise<TraderIntelligenceEntryPurposeRecord | null>;
  insert(
    context: OrgContext,
    record: TraderIntelligenceEntryPurposeRecord,
    permit: ForecastDecisionPersistencePermit,
  ): Promise<void>;
};

export type ForecastDecisionBundleRepository = {
  persist(
    context: OrgContext,
    bundle: ForecastDecisionBundle,
    authorization: ForecastDecisionPersistenceAuthorizationV2,
  ): Promise<ForecastDecisionBundle>;
};

export type ForecastDecisionPersistenceAuthorizationV2 = Readonly<{
  authority: InformationSufficiencyRuntimeAuthorityV2;
}>;

export type ForecastDecisionRuntime = {
  forecastRecordRepository: ForecastRecordRepository;
  decisionRecordRepository: DecisionRecordRepository;
  decisionForecastLinkRepository: DecisionForecastLinkRepository;
  entryPurposeRecordRepository: EntryPurposeRecordRepository;
};
