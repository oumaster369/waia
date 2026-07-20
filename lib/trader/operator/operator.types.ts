export type OperatorAuditActorKind = "operator" | "human" | "system";

export type OperatorAuditEntry = {
  id: string;
  organizationId: string;
  actionKind: string;
  actionPayloadJson: string;
  recommendationJson: string | null;
  actorKind: OperatorAuditActorKind;
  contentDigest: string;
  createdAt: Date;
};

export type InsertOperatorAuditRow = {
  id: string;
  actionKind: string;
  actionPayloadJson: string;
  recommendationJson?: string | null;
  actorKind: OperatorAuditActorKind;
  contentDigest: string;
  createdAt: Date;
};

export type OperatorRecommendation = {
  summary: string;
  rationale: string;
  suggestedActions: string[];
  confidence: "low" | "medium" | "high";
};

export type OperatorServiceStateSnapshot = {
  organizationId: string;
  strategyId?: string;
  hypothesisCount?: number;
  backtestRunCount?: number;
  pendingPromotionCount?: number;
};

export type OperatorRecommendInput = {
  organizationId: string;
  focusStrategyId?: string;
  promptContext?: string;
};

export type OperatorRecommendResult = {
  recommendation: OperatorRecommendation;
  auditEntryId: string;
  providerOk: boolean;
};
