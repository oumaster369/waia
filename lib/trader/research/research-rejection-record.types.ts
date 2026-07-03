import type { MultiRegimeCoverageReport } from "@/lib/trader/research/regime-coverage";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";

export const RESEARCH_REJECTION_RECORD_SCHEMA_VERSION =
  "waia.trader.research-rejection-record.v1" as const;

export type ResearchRejectionFailureCode =
  | "MULTI_REGIME_COVERAGE_INSUFFICIENT"
  | "OTHER_PIPELINE_FAILURE";

export type RejectionMissingBucket = "non_trending" | "down_regime";

export type ResearchRejectionRecordBody = {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  candidateId: string;
  datasetId: string;
  backtestRunId: string;
  blindValidationResultId: string;
  failureCode: ResearchRejectionFailureCode;
  failureMessage: string;
  blindConsumed: boolean;
  walkForwardWindowCount: number;
  validationMetrics: ResearchValidationMetrics;
  blindMetrics: ResearchValidationMetrics;
  bundleRegimeCoverage: MultiRegimeCoverageReport;
  observedRegimes: string[];
  missingBuckets: RejectionMissingBucket[];
  builderGitSha: string | null;
  rejectedAt: string;
};

export type ResearchRejectionRecord = {
  schemaVersion: typeof RESEARCH_REJECTION_RECORD_SCHEMA_VERSION;
  envelope: {
    contentDigest: string;
  };
  recordBody: ResearchRejectionRecordBody;
};

export type CampaignOutcomeKind = "qualified" | "rejected";

export type CampaignOutcomeSnapshot = {
  kind: CampaignOutcomeKind;
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  candidateId: string;
  rejectionRecord?: ResearchRejectionRecord;
};
