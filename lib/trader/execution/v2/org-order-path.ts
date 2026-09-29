import { createHash } from "node:crypto";

import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { runWaiaPostgresTransaction, type WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import {
  admitRiskAllowanceV2Postgres,
  type AdmitRiskAllowanceV2Input,
  type AdmitRiskAllowanceV2Result,
} from "@/lib/trader/risk/v2/risk-allowance-repository-postgres";
import type { CanonicalDecisionCapitalAuthorityV2Deps } from "@/lib/trader/runtime-v2/decision-capital-authority-v2";

import {
  ExecutionV2AuthorityRefusedError,
  type BindExecutionAuthorityV2Input,
} from "./authority-postgres";
import {
  createPostgresExecutionV2Service,
  type ExecutionV2ConnectorResolver,
  type ExecutionV2SubmissionResult,
} from "./connector-dispatch";
import { assertExecutionV2LiveGatesPostgres, ExecutionV2LiveGateRefusedError } from "./live-gates";

export type ExecutionV2OrderService = ReturnType<typeof createPostgresExecutionV2Service>;

const UNQUALIFIED_DECISION_DIGEST = createHash("sha256")
  .update("waia.trader.execution_v2.decision_not_qualified")
  .digest("hex");

/**
 * Pre-bind live gate. Bind repeats the same read inside its transaction, so a
 * hook that returns without checking cannot admit a live order.
 */
export function createAssertExecutionV2LiveAuthorized(
  db: WaiaPostgresDb,
  env?: Record<string, unknown>,
): (context: OrgContext, request: BindExecutionAuthorityV2Input) => Promise<void> {
  return async (context, request) => {
    await runWaiaPostgresTransaction(db, async (tx) => {
      try {
        await assertExecutionV2LiveGatesPostgres(tx, context, request, env);
      } catch (error) {
        if (error instanceof ExecutionV2LiveGateRefusedError) {
          throw new ExecutionV2AuthorityRefusedError(error.reason);
        }
        throw error;
      }
    });
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

  const decisionCapitalAuthorityV2: CanonicalDecisionCapitalAuthorityV2Deps = {
    async decide(request) {
      return {
        status: "NO_TRADE",
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
  };

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
