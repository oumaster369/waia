import type { GuardianReasonRecord } from "@/lib/trader/guardian/guardian-reason-record.types";

export const guardianDecisionValues = ["HOLD", "EXIT_PARTIAL", "EXIT_FULL"] as const;
export type GuardianDecision = (typeof guardianDecisionValues)[number];

export const exitIntentKindValues = ["REDUCE_LONG", "CLOSE_LONG"] as const;
export type ExitIntentKind = (typeof exitIntentKindValues)[number];

/** One auditable guardian outcome per open lot per bar. */
export type GuardianPositionEvaluation = {
  evaluationId: string;
  positionLotId: string;
  tradeId: string;
  symbol: string;
  strategyId: string;
  strategyVersion: string;
  openingStrategySignalId: string;
  decision: GuardianDecision;
  reason: GuardianReasonRecord;
  occurredAt: string;
};

/** Emitted when decision === EXIT_PARTIAL or EXIT_FULL. */
export type ExitIntent = {
  intentId: string;
  evaluationId: string;
  kind: ExitIntentKind;
  positionLotId: string;
  tradeId: string;
  symbol: string;
  side: "sell";
  quantity: string;
  openingStrategySignalId: string;
  strategyId: string;
  strategyVersion: string;
  referencePrice: string;
  accountKey: string;
  reason: GuardianReasonRecord;
  clientOrderId: string;
  idempotencyKey: string;
};

export type GuardianCycleResult = {
  evaluations: GuardianPositionEvaluation[];
  exitIntents: ExitIntent[];
};
