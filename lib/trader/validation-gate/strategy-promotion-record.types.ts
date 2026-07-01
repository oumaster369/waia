import type {
  PaperEvaluationEvidenceSlot,
  PaperEvaluationExportDocument,
} from "@/lib/trader/paper/paper-evaluation-export.types";
import type {
  ResearchEvidenceDocument,
  ResearchEvidenceSlot,
} from "@/lib/trader/research/research-evidence-export.types";

export type { PaperEvaluationEvidenceSlot };
export type { ResearchEvidenceDocument, ResearchEvidenceSlot };

export const STRATEGY_PROMOTION_RECORD_SCHEMA_VERSION =
  "waia.trader.strategy-promotion-record.v1" as const;

export type StrategyPromotionRecordSchemaVersion = typeof STRATEGY_PROMOTION_RECORD_SCHEMA_VERSION;

export const promotionGovernanceStates = [
  "DRAFT",
  "PENDING_CONFIRM",
  "COOLING_OFF",
  "EFFECTIVE",
  "CANCELLED",
  "REVOKED",
] as const;

export type PromotionGovernanceState = (typeof promotionGovernanceStates)[number];

export const strategyTargetDeploymentStates = ["LIVE_LIMITED"] as const;

export type StrategyTargetDeploymentState = (typeof strategyTargetDeploymentStates)[number];

export type PromotionCostModel = {
  feesBps?: string;
  slippageBps?: string;
  notes?: string;
};

export type ConfidenceAttestation = {
  edgeNetOfCosts: string;
  liveTracksPaper: string;
  downsideRiskBounded: string;
};

export type StrategyPromotionRecordPayload = {
  schemaVersion: StrategyPromotionRecordSchemaVersion;
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  gitCommitSha: string;
  targetDeploymentState: StrategyTargetDeploymentState;
  hypothesis: string;
  intendedRegime: string;
  costModel: PromotionCostModel;
  failureModes: string[];
  reasonCodeDistribution: Record<string, number>;
  paperTradingEvidence: PaperEvaluationEvidenceSlot;
  researchEvidence?: ResearchEvidenceSlot;
  confidenceAttestation: ConfidenceAttestation;
  recordContentDigest: string;
};

export type StrategyPromotionRecordView = StrategyPromotionRecordPayload & {
  /** Denormalized from paperTradingEvidence.contentDigest for indexed lookup. */
  evidenceContentDigest: string;
  id: string;
  state: PromotionGovernanceState;
  actorId: string | null;
  requestedAt: Date | null;
  confirmedAt: Date | null;
  coolingOffEndsAt: Date | null;
  effectiveAt: Date | null;
  cancelledAt: Date | null;
  revokedAt: Date | null;
  supersededByRecordId: string | null;
  stateVersion: number;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StrategyLiveAuthorizationInput = {
  strategyId: string;
  strategyVersion: string;
};

export type PromotionPreview = {
  record: StrategyPromotionRecordView;
  coolingOffMs: number;
  eligibleAt: Date | null;
  remainingMs: number;
  confirmable: boolean;
  effectiveEligible: boolean;
};

export type PromotionActor = {
  actorType: "user" | "admin" | "agent" | "service" | "system";
  actorId: string | null;
};

export type AssembleStrategyPromotionRecordInput = {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  gitCommitSha: string;
  hypothesis: string;
  intendedRegime: string;
  costModel: PromotionCostModel;
  failureModes: string[];
  reasonCodeDistribution: Record<string, number>;
  paperTradingEvidenceDocument: PaperEvaluationExportDocument;
  researchEvidenceDocument?: ResearchEvidenceDocument;
  confidenceAttestation: ConfidenceAttestation;
};

export type RequestPromotionInput = {
  idempotencyKey?: string;
  assembly: AssembleStrategyPromotionRecordInput;
};

export type PromotionTransitionInput = {
  expectedStateVersion: number;
  coolingOffMs?: number;
  reason?: string;
};

export type InsertPromotionRecordInput = StrategyPromotionRecordPayload & {
  id: string;
  state: PromotionGovernanceState;
  actorId: string | null;
  requestedAt: Date | null;
  idempotencyKey: string | null;
};

export type PromotionGovernancePatch = {
  state: PromotionGovernanceState;
  confirmedAt?: Date | null;
  coolingOffEndsAt?: Date | null;
  effectiveAt?: Date | null;
  cancelledAt?: Date | null;
  revokedAt?: Date | null;
  supersededByRecordId?: string | null;
  stateVersion: number;
  updatedAt: Date;
};
