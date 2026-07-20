import type { BacktestRunView } from "@/lib/trader/backtest/backtest-repository-postgres";
import type { ResearchDatasetRecord } from "@/lib/trader/market-data/research-dataset-repository-postgres";
import type { EvolutionCycleMvp } from "@/lib/trader/research/evolution-cycle-mvp.types";
import type { ResearchRejectionRecord } from "@/lib/trader/research/research-rejection-record.types";
import type {
  BlindValidationResult,
  ResearchValidationMetrics,
  StrategyCandidate,
  WalkForwardWindowRecord,
} from "@/lib/trader/research/strategy-candidate.types";

export type ValidationMetricsSource = "sealed_dataset_replay";

export type ResearchFailureReconstructionContext = {
  candidate: StrategyCandidate;
  blindResult: BlindValidationResult;
  walkForwardWindows: WalkForwardWindowRecord[];
  walkForwardMetrics: ResearchValidationMetrics[];
  blindMetrics: ResearchValidationMetrics;
  dataset: ResearchDatasetRecord;
  validationBacktestRun: BacktestRunView;
};

export type ReconstructResearchFailureArtifactsResult = {
  rejectionRecord: ResearchRejectionRecord;
  evolutionCycle: EvolutionCycleMvp;
  rejectionRecordPath: string;
  evolutionCyclePath: string;
  validationMetricsSource: ValidationMetricsSource;
  finalized: boolean;
};
