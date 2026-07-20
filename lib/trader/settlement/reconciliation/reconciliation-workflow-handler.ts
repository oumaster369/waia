import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import type { WaiaRuntimeRouteOutcome } from "@/lib/observability/waia-runtime-route-telemetry";
import {
  isWaiaConfigError,
  safeTelemetryErrorClass,
} from "@/lib/observability/waia-runtime-route-telemetry";
import { hasTraderAccessForUser } from "@/lib/trader/access-gate";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  createPostgresAccountStatusRepository,
  createPostgresInvoiceSettlementRepository,
} from "@/lib/trader/settlement/account-status-repository-postgres";
import {
  createSqliteAccountStatusRepository,
  createSqliteInvoiceSettlementRepository,
} from "@/lib/trader/settlement/account-status-repository-sqlite";
import { claimCase } from "@/lib/trader/settlement/reconciliation/commands/claim-case";
import { releaseCase } from "@/lib/trader/settlement/reconciliation/commands/release-case";
import { startReview } from "@/lib/trader/settlement/reconciliation/commands/start-review";
import { proposeResolution } from "@/lib/trader/settlement/reconciliation/commands/propose-resolution";
import { cancelProposal } from "@/lib/trader/settlement/reconciliation/commands/cancel-proposal";
import { executeResolution } from "@/lib/trader/settlement/reconciliation/commands/execute-resolution";
import { escalateExternal } from "@/lib/trader/settlement/reconciliation/commands/escalate-external";
import { reopenFromEscalation } from "@/lib/trader/settlement/reconciliation/commands/reopen-from-escalation";
import { createPostgresReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository-postgres";
import { createSqliteReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository-sqlite";
import {
  ReconciliationApplicationAlreadyExistsError,
  ReconciliationCaseNotFoundError,
  ReconciliationCoolingOffNotElapsedError,
  ReconciliationIllegalTransitionError,
  ReconciliationInvoiceNotEligibleError,
  ReconciliationNotLeaseHolderError,
  ReconciliationProposalNotLiveError,
  ReconciliationStaleConcurrencyTokenError,
} from "@/lib/trader/settlement/reconciliation/reconciliation.errors";
import type { ReconciliationResolutionType } from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import { createPostgresSettlementApplicationsRepository } from "@/lib/trader/settlement/settlement-applications-repository-postgres";
import { createSqliteSettlementApplicationsRepository } from "@/lib/trader/settlement/settlement-applications-repository-sqlite";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export type ReconciliationWorkflowHandlerResult = {
  status: number;
  body: ApiErrorEnvelope | { case: unknown; event: unknown };
  outcome: WaiaRuntimeRouteOutcome;
  errorClass?: string;
  waiaDbBackend?: "sqlite" | "postgres";
};

export type ReconciliationWorkflowHandlerDeps = {
  getUserId: () => Promise<string | null>;
  hasTraderAccess: (userId: string) => Promise<boolean>;
  getRuntimeDb: () => Promise<WaiaRuntimeDb>;
  disposeRuntimeDb: (runtime: WaiaRuntimeDb | undefined) => Promise<unknown>;
};

function errorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } };
}

function mapDomainError(error: unknown): ReconciliationWorkflowHandlerResult | null {
  if (error instanceof ReconciliationCaseNotFoundError) {
    return {
      status: 404,
      body: errorEnvelope("NOT_FOUND", error.message),
      outcome: "client_error",
    };
  }
  if (
    error instanceof ReconciliationIllegalTransitionError ||
    error instanceof ReconciliationNotLeaseHolderError ||
    error instanceof ReconciliationInvoiceNotEligibleError ||
    error instanceof ReconciliationProposalNotLiveError ||
    error instanceof ReconciliationCoolingOffNotElapsedError
  ) {
    return { status: 409, body: errorEnvelope("CONFLICT", error.message), outcome: "client_error" };
  }
  if (
    error instanceof ReconciliationStaleConcurrencyTokenError ||
    error instanceof ReconciliationApplicationAlreadyExistsError
  ) {
    return {
      status: 409,
      body: errorEnvelope("STALE_STATE", error.message),
      outcome: "client_error",
    };
  }
  return null;
}

type CommandBody = {
  expectedLastEventSeq: number;
  idempotencyKey: string;
  [key: string]: unknown;
};

function parseCommandBody(request: Request): Promise<CommandBody> {
  return request.json() as Promise<CommandBody>;
}

async function authorizeOperator(deps: ReconciliationWorkflowHandlerDeps) {
  const userId = await deps.getUserId();
  if (!userId) {
    return {
      ok: false as const,
      result: {
        status: 401,
        body: errorEnvelope("UNAUTHORIZED", "Sign in required."),
        outcome: "client_error" as const,
      },
    };
  }
  const hasAccess = await deps.hasTraderAccess(userId);
  if (!hasAccess) {
    return {
      ok: false as const,
      result: {
        status: 403,
        body: errorEnvelope("FORBIDDEN", "Trader access required."),
        outcome: "client_error" as const,
      },
    };
  }
  return {
    ok: true as const,
    userId,
    orgId: personalOrganizationIdFromUserId(userId),
    operator: { actorType: "user" as const, actorId: userId },
  };
}

export async function handleReconciliationWorkflowCommand(
  caseId: string,
  command:
    | "claim"
    | "release"
    | "review"
    | "propose"
    | "cancel-proposal"
    | "execute"
    | "escalate"
    | "reopen",
  request: Request,
  deps: ReconciliationWorkflowHandlerDeps,
): Promise<ReconciliationWorkflowHandlerResult> {
  let runtime: WaiaRuntimeDb | undefined;
  try {
    const auth = await authorizeOperator(deps);
    if (!auth.ok) {
      return auth.result;
    }

    const body = await parseCommandBody(request);
    if (!body.idempotencyKey || typeof body.expectedLastEventSeq !== "number") {
      return {
        status: 400,
        body: errorEnvelope(
          "INVALID_REQUEST",
          "expectedLastEventSeq and idempotencyKey are required.",
        ),
        outcome: "client_error",
      };
    }

    runtime = await deps.getRuntimeDb();
    const context = requireOrgContext(auth.orgId);
    const baseInput = {
      caseId,
      expectedLastEventSeq: body.expectedLastEventSeq,
      idempotencyKey: body.idempotencyKey,
    };

    let result: { case: unknown; event: unknown };

    if (runtime.kind === "sqlite") {
      const caseRepository = createSqliteReconciliationCaseRepository(runtime.db);
      const writeAudit = (input: Parameters<typeof writeTraderAuditLogSqlite>[1]) =>
        writeTraderAuditLogSqlite(runtime!.db as never, input);

      switch (command) {
        case "claim":
          result = await claimCase({ caseRepository, writeAudit }, context, auth.operator, {
            ...baseInput,
            claimLeaseMs: typeof body.claimLeaseMs === "number" ? body.claimLeaseMs : null,
          });
          break;
        case "release":
          result = await releaseCase({ caseRepository, writeAudit }, context, auth.operator, {
            ...baseInput,
            reason: typeof body.reason === "string" ? body.reason : undefined,
          });
          break;
        case "review":
          result = await startReview(
            { caseRepository, writeAudit },
            context,
            auth.operator,
            baseInput,
          );
          break;
        case "propose":
          result = await proposeResolution(
            {
              caseRepository,
              invoiceSettlementRepository: createSqliteInvoiceSettlementRepository(runtime.db),
              writeAudit,
            },
            context,
            auth.operator,
            {
              ...baseInput,
              resolutionType: body.resolutionType as ReconciliationResolutionType,
              targetInvoiceId:
                typeof body.targetInvoiceId === "string" ? body.targetInvoiceId : null,
              rationale: typeof body.rationale === "string" ? body.rationale : "",
              coolingOffMs: typeof body.coolingOffMs === "number" ? body.coolingOffMs : null,
              recommendationRef:
                typeof body.recommendationRef === "string" ? body.recommendationRef : null,
            },
          );
          break;
        case "cancel-proposal":
          result = await cancelProposal({ caseRepository, writeAudit }, context, auth.operator, {
            ...baseInput,
            reason: typeof body.reason === "string" ? body.reason : "",
          });
          break;
        case "execute":
          result = await executeResolution(
            {
              caseRepository,
              settlementApplicationsRepository: createSqliteSettlementApplicationsRepository(
                runtime.db,
              ),
              invoiceSettlementRepository: createSqliteInvoiceSettlementRepository(runtime.db),
              accountStatusRepository: createSqliteAccountStatusRepository(runtime.db),
              writeAudit,
            },
            context,
            auth.operator,
            {
              ...baseInput,
              decisionId: typeof body.decisionId === "string" ? body.decisionId : "",
              confirmToken: typeof body.confirmToken === "string" ? body.confirmToken : "",
            },
          );
          break;
        case "escalate":
          result = await escalateExternal({ caseRepository, writeAudit }, context, auth.operator, {
            ...baseInput,
            reason: typeof body.reason === "string" ? body.reason : "",
          });
          break;
        case "reopen":
          result = await reopenFromEscalation(
            { caseRepository, writeAudit },
            context,
            auth.operator,
            {
              ...baseInput,
              reason: typeof body.reason === "string" ? body.reason : "",
            },
          );
          break;
      }
    } else {
      const pgDb = runtime.db;

      const caseRepository = createPostgresReconciliationCaseRepository(pgDb);
      const writeAudit = (input: Parameters<typeof writeTraderAuditLogPostgres>[1]) =>
        writeTraderAuditLogPostgres(pgDb, input);

      switch (command) {
        case "claim":
          result = await claimCase({ caseRepository, writeAudit }, context, auth.operator, {
            ...baseInput,
            claimLeaseMs: typeof body.claimLeaseMs === "number" ? body.claimLeaseMs : null,
          });
          break;
        case "release":
          result = await releaseCase({ caseRepository, writeAudit }, context, auth.operator, {
            ...baseInput,
            reason: typeof body.reason === "string" ? body.reason : undefined,
          });
          break;
        case "review":
          result = await startReview(
            { caseRepository, writeAudit },
            context,
            auth.operator,
            baseInput,
          );
          break;
        case "propose":
          result = await proposeResolution(
            {
              caseRepository,
              invoiceSettlementRepository: createPostgresInvoiceSettlementRepository(pgDb),
              writeAudit,
            },
            context,
            auth.operator,
            {
              ...baseInput,
              resolutionType: body.resolutionType as ReconciliationResolutionType,
              targetInvoiceId:
                typeof body.targetInvoiceId === "string" ? body.targetInvoiceId : null,
              rationale: typeof body.rationale === "string" ? body.rationale : "",
              coolingOffMs: typeof body.coolingOffMs === "number" ? body.coolingOffMs : null,
              recommendationRef:
                typeof body.recommendationRef === "string" ? body.recommendationRef : null,
            },
          );
          break;
        case "cancel-proposal":
          result = await cancelProposal({ caseRepository, writeAudit }, context, auth.operator, {
            ...baseInput,
            reason: typeof body.reason === "string" ? body.reason : "",
          });
          break;
        case "execute":
          result = await runWaiaPostgresTransaction(pgDb, async (tx) =>
            executeResolution(
              {
                caseRepository: createPostgresReconciliationCaseRepository(tx),
                settlementApplicationsRepository:
                  createPostgresSettlementApplicationsRepository(tx),
                invoiceSettlementRepository: createPostgresInvoiceSettlementRepository(tx),
                accountStatusRepository: createPostgresAccountStatusRepository(tx),
                writeAudit: (input) => writeTraderAuditLogPostgres(tx, input),
              },
              context,
              auth.operator,
              {
                ...baseInput,
                decisionId: typeof body.decisionId === "string" ? body.decisionId : "",
                confirmToken: typeof body.confirmToken === "string" ? body.confirmToken : "",
              },
            ),
          );
          break;
        case "escalate":
          result = await escalateExternal({ caseRepository, writeAudit }, context, auth.operator, {
            ...baseInput,
            reason: typeof body.reason === "string" ? body.reason : "",
          });
          break;
        case "reopen":
          result = await reopenFromEscalation(
            { caseRepository, writeAudit },
            context,
            auth.operator,
            {
              ...baseInput,
              reason: typeof body.reason === "string" ? body.reason : "",
            },
          );
          break;
      }
    }

    return {
      status: 200,
      body: result,
      outcome: "success",
      waiaDbBackend: runtime.kind,
    };
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) {
      return { ...mapped, waiaDbBackend: runtime?.kind };
    }
    return {
      status: 500,
      body: errorEnvelope("INTERNAL_ERROR", "Something went wrong."),
      outcome: !runtime && isWaiaConfigError(error) ? "config_error" : "internal_error",
      errorClass: safeTelemetryErrorClass(error),
      waiaDbBackend: runtime?.kind,
    };
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}

export function createProductionReconciliationWorkflowHandlerDeps(): ReconciliationWorkflowHandlerDeps {
  return {
    getUserId: getOptionalSessionUserId,
    hasTraderAccess: hasTraderAccessForUser,
    getRuntimeDb: getWaiaRuntimeDb,
    disposeRuntimeDb: disposeWaiaRuntimeDb,
  };
}
