import type {
  IntelligenceCycleBundle,
  TraderIntelligenceConvictionRecord,
  TraderIntelligenceCycleEnvelopeRecord,
  TraderIntelligenceHypothesisRecord,
} from "@/lib/trader/intelligence/records/intelligence-records.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type CycleEnvelopeRepository = {
  findByBusinessKey(
    context: OrgContext,
    key: { runId: string; cycleId: string; symbol: string },
  ): Promise<TraderIntelligenceCycleEnvelopeRecord | null>;
  insert(context: OrgContext, record: TraderIntelligenceCycleEnvelopeRecord): Promise<void>;
};

export type HypothesisRecordRepository = {
  findByBusinessKey(
    context: OrgContext,
    key: { runId: string; cycleId: string; symbol: string; hypothesisType: string },
  ): Promise<TraderIntelligenceHypothesisRecord | null>;
  insert(context: OrgContext, record: TraderIntelligenceHypothesisRecord): Promise<void>;
};

export type ConvictionRecordRepository = {
  findByBusinessKey(
    context: OrgContext,
    key: { runId: string; cycleId: string; symbol: string },
  ): Promise<TraderIntelligenceConvictionRecord | null>;
  insert(context: OrgContext, record: TraderIntelligenceConvictionRecord): Promise<void>;
};

export type IntelligenceCycleBundleRepository = {
  persist(context: OrgContext, bundle: IntelligenceCycleBundle): Promise<IntelligenceCycleBundle>;
};

export type IntelligenceRecordsRuntime = {
  cycleEnvelopeRepository: CycleEnvelopeRepository;
  hypothesisRecordRepository: HypothesisRecordRepository;
  convictionRecordRepository: ConvictionRecordRepository;
};
