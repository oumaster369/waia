import type { ReplayProviderSidecar } from "@/lib/trader/market-data/replay-fused-context-builder";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import type { PortfolioCycleContext } from "@/lib/trader/paper/paper-cycle.types";
import type { M9BlindAuthorizationScope } from "@/lib/trader/research/m9-operator-authorization";
import type { ResearchGuardianConfig } from "@/lib/trader/research/research-guardian-config";
import type { ResearchPortfolioConfig } from "@/lib/trader/research/research-portfolio-config";
import type { ResearchValidationBacktestArtifactSink } from "@/lib/trader/research/research-backtest-runner";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";
import {
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
} from "@/lib/trader/research/strategy-candidate.types";

export type ResearchPipelineBacktestOptions = {
  metricsSchemaVersion?:
    | typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1
    | typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION;
  portfolioConfig?: ResearchPortfolioConfig;
  guardian?: ResearchGuardianConfig;
  /** Required digest before blind holdout when set via M9 campaign CLI. */
  operatorBlindAuthorization?: string;
  blindAuthorizationScope?: M9BlindAuthorizationScope;
  validationArtifactSink?: ResearchValidationBacktestArtifactSink;
  /** Optional replay provider sidecar for tier-2 cross-venue/crowd/global in M9 artifacts. */
  providerSidecar?: ReplayProviderSidecar;
};

export type RunResearchPipelineResultArtifacts = {
  validationMetrics: ResearchValidationMetrics;
  validationCycleResults?: readonly PaperCycleResult[];
  validationPortfolioContext?: PortfolioCycleContext;
};
