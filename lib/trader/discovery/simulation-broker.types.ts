import type {
  RunResearchPipelineInput,
  RunResearchPipelineResult,
} from "@/lib/trader/research/research-orchestrator";
import type { InsertStrategyCandidateRow } from "@/lib/trader/research/strategy-candidate.types";
import type { StrategyCandidate } from "@/lib/trader/research/strategy-candidate.types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { EpistemicEvidenceRecord } from "@/lib/trader/discovery/evidence.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type SimulationBrokerRegisterDeps = {
  registerCandidate: (
    ex: Pick<WaiaPostgresDb, "select" | "insert" | "update" | "delete">,
    context: OrgContext,
    row: InsertStrategyCandidateRow,
  ) => Promise<StrategyCandidate>;
};

export type SimulationBrokerRunDeps = {
  runPipeline: (
    ex: Pick<WaiaPostgresDb, "select" | "insert" | "update" | "delete">,
    input: RunResearchPipelineInput,
  ) => Promise<RunResearchPipelineResult>;
};

export type SimulationBrokerDeps = SimulationBrokerRegisterDeps & SimulationBrokerRunDeps;

export type SimulationBrokerInput = {
  context: OrgContext;
  campaignId: string;
  pipelineInput: RunResearchPipelineInput;
};

export type SimulationBrokerResult = {
  candidateId: string;
  metricsDigest: string;
  pipelineResult: RunResearchPipelineResult;
  evidenceRecords: readonly EpistemicEvidenceRecord[];
};
