import type { ControlReplayAuthorityIdentity } from "@/lib/trader/observability/control-replay-test-authority";

export type TestOnlyExecutionV2AuthorityRequest = Readonly<{
  authority: ControlReplayAuthorityIdentity;
  organizationId: string;
  accountId: string;
  decision: Readonly<{
    decisionId: string;
    semanticDigestHex: string;
    contentDigestHex: string;
    executionPolicyDigestHex: string;
    economicSizeSetId: string;
    economicSizeSetDigestHex: string;
  }>;
  symbol: string;
  baseAsset: string;
  qualifiedQuantity: string;
  referencePrice: string;
}>;

export type TestOnlyExecutionV2AuthorityProof = Readonly<{
  riskAllowanceId: string;
  riskAllowanceContentDigestHex: string;
  executionPlanId: string;
  executionPlanContentDigestHex: string;
  executionAttemptId: string;
  executionAttemptContentDigestHex: string;
  orderId: string;
  clientOrderId: string;
  qualifiedQuantity: string;
  firstBindConsumedNow: true;
  restartConsumedNow: false;
  restartPreservedEffectIdentity: true;
  reservationTransferredToPending: true;
  networkSubmissionCalls: 1;
  restartSubmissionCalls: 0;
  terminalStatus: "RECONCILIATION_REQUIRED";
  reportTypes: readonly string[];
}>;

/**
 * Injected only by admitted tests. Implementations must use a disposable local
 * PostgreSQL database and must never perform an external connector effect.
 */
export type TestOnlyExecutionV2AuthorityPort = (
  request: TestOnlyExecutionV2AuthorityRequest,
) => Promise<TestOnlyExecutionV2AuthorityProof>;
