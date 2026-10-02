import { createHash } from "node:crypto";

import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { sql } from "drizzle-orm";

import { runWaiaPostgresTransaction, type WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import {
  admitRiskAllowanceV2Postgres,
  readRiskAccountStateV2Postgres,
  RiskV2AdmissionRefusedError,
  type AdmitRiskAllowanceV2Input,
  type AdmitRiskAllowanceV2Result,
} from "@/lib/trader/risk/v2/risk-allowance-repository-postgres";
import type {
  CanonicalDecisionCapitalAuthorityV2Deps,
  DecisionAuthorityV2,
  DecisionStageOutcomeV2,
} from "@/lib/trader/runtime-v2/decision-capital-authority-v2";

import {
  ExecutionV2AuthorityRefusedError,
  type BindExecutionAuthorityV2Input,
} from "./authority-postgres";
import {
  createPostgresExecutionV2Service,
  type ExecutionV2ConnectorResolver,
  type ExecutionV2SubmissionResult,
} from "./connector-dispatch";
import { recordExecutionV2LiveGateVerdictPostgres, emitCommittedExecutionV2LiveGateTelemetry } from "./live-gates";

export type ExecutionV2OrderService = ReturnType<typeof createPostgresExecutionV2Service>;

export type ExecutionV2CycleSubmitPort = {
  admitAndSubmit(
    context: OrgContext,
    request: ExecutionV2AdmitAndSubmitInput,
  ): Promise<ExecutionV2AdmitAndSubmitResult>;
};

/**
 * Paper and live cycles call this when a strategy decision exists.
 * NO_TRADE does not admit. An actionable decision without an admission
 * request fails closed and does not place an order.
 */
export async function submitExecutionV2ForStrategyDecision(
  decision: DecisionStageOutcomeV2,
  executionV2: ExecutionV2CycleSubmitPort | undefined,
  context: OrgContext,
  request: ExecutionV2AdmitAndSubmitInput | null,
): Promise<ExecutionV2AdmitAndSubmitResult | null> {
  if (decision.status === "NO_TRADE") return null;
  if (!executionV2) throw new Error("execution_v2_required");
  if (!request) throw new Error("EXECUTION_V2_ADMISSION_INPUTS_INCOMPLETE");
  return executionV2.admitAndSubmit(context, request);
}

export type ExecutionV2ActionableAdmission = (
  decision: DecisionAuthorityV2,
) => ExecutionV2AdmitAndSubmitInput | null;

const UNQUALIFIED_DECISION_DIGEST = createHash("sha256")
  .update("waia.trader.execution_v2.decision_not_qualified")
  .digest("hex");

/** Fixed pre-qualification decision; contains no database or connector capability. */
export function createUnqualifiedPaperDecisionCapitalAuthorityV2(): CanonicalDecisionCapitalAuthorityV2Deps {
  return Object.freeze({
    async decide(request) {
      return {
        status: "NO_TRADE" as const,
        decisionId: "execution-v2-unqualified",
        decisionContentDigestHex: UNQUALIFIED_DECISION_DIGEST,
        forecastAuthorityContentDigestHex: request.forecastOutcome.authority.contentDigestHex,
        reasonCodes: ["EXECUTION_V2_DECISION_NOT_QUALIFIED"],
      };
    },
    async assessRisk() {
      throw new Error("EXECUTION_V2_RISK_STAGE_UNREACHABLE");
    },
    async execute() {
      throw new Error("EXECUTION_V2_ADMISSION_INPUTS_INCOMPLETE");
    },
  });
}

/**
 * Preliminary live metadata check, not independent execution authorization.
 * Missing signer authority is deferred only to the mandatory direct bind, which
 * first preserves intrinsic kill/expiry terminalization and then refuses before
 * any execution effects. Concrete credential faults still commit their kill here.
 */
export function createAssertExecutionV2LiveAuthorized(
  db: WaiaPostgresDb,
  env?: Record<string, unknown>,
): (context: OrgContext, request: BindExecutionAuthorityV2Input) => Promise<void> {
  return async (context, request) => {
    const scoped = requireOrgContext(context.organizationId);
    if (request.allowance.organizationId !== scoped.organizationId ||
        request.policy.organizationId !== scoped.organizationId) {
      throw new ExecutionV2AuthorityRefusedError("TENANT_SCOPE_MISMATCH");
    }
    const verdict = await runWaiaPostgresTransaction(db, async (tx) => {
      // Same lock order as direct bind and the final pre-POST check.
      await tx.execute(sql`select set_config('lock_timeout', '5s', true)`);
      if (!(await readRiskAccountStateV2Postgres(tx, scoped, request.allowance.accountId, true))) {
        throw new RiskV2AdmissionRefusedError("RISK_ACCOUNT_STATE_MISSING");
      }
      return recordExecutionV2LiveGateVerdictPostgres(tx, scoped, request, env);
    });
    if (!verdict.ok && verdict.reason === "SIGNER_BINDING_UNAVAILABLE") return;
    if (!verdict.ok) {
      await emitCommittedExecutionV2LiveGateTelemetry(scoped.organizationId, verdict);
      throw new ExecutionV2AuthorityRefusedError(verdict.reason);
    }
  };
}

export type ExecutionV2AdmitAndSubmitInput = Readonly<{
  admission: AdmitRiskAllowanceV2Input;
  bind: Omit<BindExecutionAuthorityV2Input, "allowance">;
}>;

export type ExecutionV2AdmitAndSubmitResult = Readonly<{
  admitted: AdmitRiskAllowanceV2Result;
  submission: ExecutionV2SubmissionResult;
}>;

/**
 * Org-scoped Execution V2 order path. Paper and live composers construct this
 * instead of calling the legacy order service. `decide` stays non-actionable
 * until a qualified decision is supplied; `submit` is the only placeOrder path.
 */
export function createOrgScopedExecutionV2OrderPath(
  input: Readonly<{
    db: WaiaPostgresDb;
    connectorFor: ExecutionV2ConnectorResolver;
    assertLiveAuthorized?: (
      context: OrgContext,
      request: BindExecutionAuthorityV2Input,
    ) => Promise<void>;
  }>,
) {
  const service = createPostgresExecutionV2Service({
    db: input.db,
    connectorFor: input.connectorFor,
    ...(input.assertLiveAuthorized ? { assertLiveAuthorized: input.assertLiveAuthorized } : {}),
  });

  const decisionCapitalAuthorityV2 = createUnqualifiedPaperDecisionCapitalAuthorityV2();

  return Object.freeze({
    service,
    decisionCapitalAuthorityV2,
    async admitAndSubmit(
      context: OrgContext,
      request: ExecutionV2AdmitAndSubmitInput,
    ): Promise<ExecutionV2AdmitAndSubmitResult> {
      const admitted = await admitRiskAllowanceV2Postgres(input.db, context, request.admission);
      const submission = await service.submit(context, {
        ...request.bind,
        allowance: admitted.allowance,
      });
      return Object.freeze({ admitted, submission });
    },
  });
}
