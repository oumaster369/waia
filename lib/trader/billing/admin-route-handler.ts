import { createAdminServiceOrgAccess } from "@/lib/trader/security/admin-service-org-access";
import { createRequire } from "node:module";
import { sql } from "drizzle-orm";
import { lockInvoiceCommandAccountPostgres } from "@/lib/trader/billing/invoice-command-lock-postgres";
import { DraftInvoiceDigestMismatchError } from "@/lib/trader/billing/invoice.errors";
import { isIssuanceAttestationComplete } from "@/lib/trader/billing/invoice-issuance.types";
import { parseBillingRealityDependencies, type BillingRealityDependenciesV1 } from "./v2/reality-dependencies-v1";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import {
  serializeCorrectionRecord,
  serializeDisputeProjection,
  serializeInvoiceRecord,
  serializeIssuedInvoice,
} from "@/lib/trader/admin-serialize";
import {
  adminClientError,
  adminSuccess,
  authorizeAdminRoute,
  mapServiceError,
  parseOrganizationId,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import {
  createPostgresBillingPeriodCloseOrchestrator,
  createSqliteBillingPeriodCloseOrchestrator,
} from "@/lib/trader/billing/billing-period-close-orchestrator";
import {
  NAKED_REALIZED_PNL_REFUSED,
  type ClosedTradeSettlementV2,
  type RealizedStrategyProfitReceiptV2,
} from "@/lib/trader/billing/v2";
import {
  createPostgresBillingGovernanceService,
  createSqliteBillingGovernanceService,
} from "@/lib/trader/billing/governance/billing-governance-service";
import type { InvoiceCorrectionType } from "@/lib/trader/billing/governance/billing-governance.types";
import { createPostgresInvoiceDisputeRepository } from "@/lib/trader/billing/governance/dispute-repository-postgres";
import { createSqliteInvoiceDisputeRepository } from "@/lib/trader/billing/governance/dispute-repository-sqlite";
import {
  createPostgresInvoiceIssuanceService,
  createSqliteInvoiceIssuanceService,
} from "@/lib/trader/billing/invoice-issuance-service";
import type { IssuanceAttestation } from "@/lib/trader/billing/invoice-issuance.types";
import {
  createPostgresInvoiceRepository,
  createSqliteInvoiceRepository,
} from "@/lib/trader/billing/invoice-repository-adapters";
import { listInvoicesByAccountPostgres } from "@/lib/trader/billing/invoice-repository-postgres";
import { listInvoicesByAccountSqlite } from "@/lib/trader/billing/invoice-repository-sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

function parseExchangeAccountId(url: URL): string | AdminRouteHandlerResult {
  const exchangeAccountId = url.searchParams.get("exchange_account_id")?.trim();
  if (!exchangeAccountId) {
    return adminClientError(
      400,
      "EXCHANGE_ACCOUNT_ID_REQUIRED",
      "exchange_account_id query param required.",
    );
  }
  return exchangeAccountId;
}

function createInvoiceRepository(
  runtime: Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>,
) {
  if (runtime.kind === "sqlite") {
    return createSqliteInvoiceRepository(runtime.db);
  }
  return createPostgresInvoiceRepository(runtime.db);
}

function createIssuanceService(
  runtime: Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>,
) {
  if (runtime.kind === "sqlite") {
    return createSqliteInvoiceIssuanceService(runtime.db);
  }
  return createPostgresInvoiceIssuanceService(runtime.db);
}

function createBillingGovernanceService(
  runtime: Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>,
) {
  if (runtime.kind === "sqlite") {
    return createSqliteBillingGovernanceService(runtime.db);
  }
  return createPostgresBillingGovernanceService(runtime.db);
}

function createDisputeRepository(
  runtime: Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>,
) {
  if (runtime.kind === "sqlite") {
    return createSqliteInvoiceDisputeRepository(runtime.db);
  }
  return createPostgresInvoiceDisputeRepository(runtime.db);
}

function createBillingPeriodCloseOrchestrator(
  runtime: Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>,
) {
  if (runtime.kind === "sqlite") {
    return createSqliteBillingPeriodCloseOrchestrator(runtime.db, {
      assertMembership: createAdminServiceOrgAccess(runtime, "admin.audit.read"),
    });
  }
  return createPostgresBillingPeriodCloseOrchestrator(runtime.db, {
      assertMembership: (context, bound) => createAdminServiceOrgAccess({ kind: "postgres", db: bound }, "admin.audit.read")(context),
    });
}

function parseRequiredString(value: unknown, field: string): string | AdminRouteHandlerResult {
  if (typeof value !== "string" || !value.trim()) {
    return adminClientError(400, "INVALID_BODY", `${field} is required.`);
  }
  return value.trim();
}

function parseRequiredDate(value: unknown, field: string): Date | AdminRouteHandlerResult {
  const raw = parseRequiredString(value, field);
  if (typeof raw !== "string") {
    return raw;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return adminClientError(400, "INVALID_BODY", `${field} must be a valid ISO-8601 timestamp.`);
  }
  return parsed;
}

export async function handleAdminInvoicesListGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const orgParsed = parseOrganizationId(url);
  if (typeof orgParsed !== "string") {
    return orgParsed;
  }
  const exchangeAccountId = parseExchangeAccountId(url);
  if (typeof exchangeAccountId !== "string") {
    return exchangeAccountId;
  }

  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, orgParsed, "admin.audit.read");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;
    const context = requireOrgContext(orgParsed);

    const invoices =
      runtime.kind === "sqlite"
        ? listInvoicesByAccountSqlite(runtime.db, context, exchangeAccountId)
        : await listInvoicesByAccountPostgres(runtime.db, context, exchangeAccountId);

    return adminSuccess({ invoices: invoices.map(serializeInvoiceRecord) }, runtime.kind);
  } catch (err) {
    return mapServiceError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}

export async function handleAdminInvoiceGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
  invoiceId: string,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const orgParsed = parseOrganizationId(url);
  if (typeof orgParsed !== "string") {
    return orgParsed;
  }

  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, orgParsed, "admin.audit.read");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;
    const context = requireOrgContext(orgParsed);
    const repository = createInvoiceRepository(runtime);
    const invoice = await repository.getById(context, invoiceId);
    if (!invoice) {
      return adminClientError(404, "INVOICE_NOT_FOUND", "Invoice not found.");
    }
    return adminSuccess({ invoice: serializeInvoiceRecord(invoice) }, runtime.kind);
  } catch (err) {
    return mapServiceError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}

type InvoiceCommandBody = {
  command?: string;
  organization_id?: string;
  attestations?: IssuanceAttestation;
  reason?: string;
};

function parseInvoiceCommandBody(raw: unknown): InvoiceCommandBody | AdminRouteHandlerResult {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return adminClientError(400, "INVALID_BODY", "Request body must be a JSON object.");
  }
  const body = raw as Record<string, unknown>;
  if (["command", "organization_id", "reason"].some((key) =>
    body[key] !== undefined && typeof body[key] !== "string")) {
    return adminClientError(400, "INVALID_BODY", "command, organization_id and reason must be strings.");
  }
  if (Object.prototype.hasOwnProperty.call(body, "cooling_off_ms")) {
    return adminClientError(400, "COOLING_OFF_OVERRIDE_FORBIDDEN", "Cooling-off is configured by the server.");
  }
  if (body.command === "approve" && !isIssuanceAttestationComplete(body.attestations)) {
    return adminClientError(400, "ATTESTATIONS_REQUIRED", "All six attestations must be literal true.");
  }
  return {
    command: body.command as string | undefined,
    organization_id: body.organization_id as string | undefined,
    attestations: body.attestations as IssuanceAttestation | undefined,
    reason: body.reason as string | undefined,
  };
}

export async function handleAdminInvoiceCommandPost(
  request: Request,
  deps: AdminRouteHandlerDeps,
  invoiceId: string,
): Promise<AdminRouteHandlerResult> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return adminClientError(400, "INVALID_BODY", "Expected JSON body.");
  }

  const bodyOrError = parseInvoiceCommandBody(parsed);
  if ("status" in bodyOrError) {
    return bodyOrError;
  }
  const body = bodyOrError;

  const organizationId = body.organization_id?.trim();
  if (!organizationId) {
    return adminClientError(400, "ORGANIZATION_ID_REQUIRED", "organization_id is required.");
  }
  try {
    requireOrgContext(organizationId);
  } catch {
    return adminClientError(400, "ORGANIZATION_ID_INVALID", "organization_id is invalid.");
  }

  const command = body.command?.trim();
  if (!command) {
    return adminClientError(400, "COMMAND_REQUIRED", "command is required.");
  }

  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, organizationId, "admin.audit.read");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;

    const context = { ...requireOrgContext(organizationId), userId: auth.userId };
    const execute = async (boundRuntime: Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>): Promise<AdminRouteHandlerResult> => {
      const service = createIssuanceService(boundRuntime);
      if (command === "approve") {
        if (!isIssuanceAttestationComplete(body.attestations)) {
          return adminClientError(400, "ATTESTATIONS_REQUIRED", "All six attestations must be literal true.");
        }
        const invoice = await service.approveInvoiceIssuance(context, {
          invoiceId, attestations: body.attestations,
        });
        return adminSuccess({ invoice: serializeInvoiceRecord(invoice) }, boundRuntime.kind);
      }
      if (command === "cancel-pending") {
        const reason = body.reason?.trim();
        if (!reason) return adminClientError(400, "REASON_REQUIRED", "reason is required.");
        const invoice = await service.cancelPendingIssuance(context, { invoiceId, reason });
        return adminSuccess({ invoice: serializeInvoiceRecord(invoice) }, boundRuntime.kind);
      }
      if (command === "issue") {
        const invoice = await service.issueInvoice(context, { invoiceId });
        return adminSuccess({ invoice: serializeIssuedInvoice(invoice) }, boundRuntime.kind);
      }
      return adminClientError(400, "UNKNOWN_COMMAND", `Unknown command: ${command}`);
    };
    if (runtime.kind === "sqlite") return await execute(runtime);
    return await runtime.db.transaction(async (tx) => {
      const rows = await tx.execute(sql`SELECT exchange_account_id FROM trader_invoices
        WHERE id = ${invoiceId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!rows[0]) return adminClientError(404, "INVOICE_NOT_FOUND", "Invoice not found.");
      if (command !== "cancel-pending") {
        await lockInvoiceCommandAccountPostgres(tx, organizationId, String(rows[0].exchange_account_id));
      }
      try {
        return await execute({ kind: "postgres", db: tx });
      } catch (error) {
        // The existing service deliberately clears stale approval for these business
        // refusals. Commit that invalidation; persistence/audit failures must roll back.
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (error instanceof DraftInvoiceDigestMismatchError ||
          ["INVOICE_RECORD_DIGEST_MISMATCH", "ISSUANCE_HWM_INCONSISTENT"].includes(code)) {
          return mapServiceError(error);
        }
        throw error;
      }
    }, { isolationLevel: "read committed" });
  } catch (err) {
    return mapServiceError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}

export async function handleAdminBillingDisputesGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const orgParsed = parseOrganizationId(url);
  if (typeof orgParsed !== "string") {
    return orgParsed;
  }

  const invoiceId = url.searchParams.get("invoice_id")?.trim();
  const disputeId = url.searchParams.get("dispute_id")?.trim();
  if (!invoiceId && !disputeId) {
    return adminClientError(
      400,
      "DISPUTE_LOOKUP_REQUIRED",
      "invoice_id or dispute_id query param required.",
    );
  }

  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, orgParsed, "admin.audit.read");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;
    const context = requireOrgContext(orgParsed);
    const governance = createBillingGovernanceService(runtime);
    const repository = createDisputeRepository(runtime);

    if (disputeId) {
      const dispute = await repository.getById(context, disputeId);
      if (!dispute) {
        return adminClientError(404, "DISPUTE_NOT_FOUND", "Dispute not found.");
      }
      return adminSuccess({ dispute: serializeDisputeProjection(dispute) }, runtime.kind);
    }

    const dispute = await governance.findOpenDisputeForInvoice(context, invoiceId!);
    return adminSuccess(
      { dispute: dispute ? serializeDisputeProjection(dispute) : null },
      runtime.kind,
    );
  } catch (err) {
    return mapServiceError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}

type BillingDisputeCommandBody = {
  command?: string;
  organization_id?: string;
  invoice_id?: string;
  dispute_id?: string;
  reason?: string;
  resolution_reason?: string;
  correction_type?: InvoiceCorrectionType;
  amount?: string;
  restored_hwm?: string;
};

function parseDisputeCommandBody(
  raw: unknown,
): BillingDisputeCommandBody | AdminRouteHandlerResult {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return adminClientError(400, "INVALID_BODY", "Request body must be a JSON object.");
  }
  return raw as BillingDisputeCommandBody;
}

export async function handleAdminBillingDisputeCommandPost(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return adminClientError(400, "INVALID_BODY", "Expected JSON body.");
  }

  const bodyOrError = parseDisputeCommandBody(parsed);
  if ("status" in bodyOrError) {
    return bodyOrError;
  }
  const body = bodyOrError;

  const organizationId = body.organization_id?.trim();
  if (!organizationId) {
    return adminClientError(400, "ORGANIZATION_ID_REQUIRED", "organization_id is required.");
  }
  try {
    requireOrgContext(organizationId);
  } catch {
    return adminClientError(400, "ORGANIZATION_ID_INVALID", "organization_id is invalid.");
  }

  const command = body.command?.trim();
  if (!command) {
    return adminClientError(400, "COMMAND_REQUIRED", "command is required.");
  }

  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, organizationId, "admin.audit.read");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;

    const context = requireOrgContext(organizationId);
    const governance = createBillingGovernanceService(runtime);

    if (command === "open") {
      const invoiceId = body.invoice_id?.trim();
      const reason = body.reason?.trim();
      if (!invoiceId || !reason) {
        return adminClientError(400, "OPEN_INPUT_INVALID", "invoice_id and reason are required.");
      }
      const dispute = await governance.openInvoiceDispute(context, {
        invoiceId,
        reason,
        openedBy: auth.userId,
      });
      return adminSuccess({ dispute: serializeDisputeProjection(dispute) }, runtime.kind);
    }

    if (command === "resolve-upheld") {
      const disputeId = body.dispute_id?.trim();
      const resolutionReason = body.resolution_reason?.trim();
      if (!disputeId || !resolutionReason) {
        return adminClientError(
          400,
          "RESOLVE_INPUT_INVALID",
          "dispute_id and resolution_reason are required.",
        );
      }
      const dispute = await governance.resolveInvoiceDisputeUpheld(context, {
        disputeId,
        resolutionReason,
        actorType: "admin",
        actorId: auth.userId,
      });
      return adminSuccess({ dispute: serializeDisputeProjection(dispute) }, runtime.kind);
    }

    if (command === "apply-correction") {
      const invoiceId = body.invoice_id?.trim();
      const reason = body.reason?.trim();
      if (
        !invoiceId ||
        !reason ||
        !body.correction_type ||
        !body.amount?.trim() ||
        !body.restored_hwm?.trim()
      ) {
        return adminClientError(
          400,
          "CORRECTION_INPUT_INVALID",
          "invoice_id, correction_type, amount, restored_hwm, and reason are required.",
        );
      }
      const result = await governance.applyOverchargeCorrection(context, {
        invoiceId,
        correctionType: body.correction_type,
        amount: body.amount.trim(),
        restoredHwm: body.restored_hwm.trim(),
        reason,
        actorType: "admin",
        actorId: auth.userId,
      });
      return adminSuccess(
        {
          correction: serializeCorrectionRecord(result.correction),
          dispute: serializeDisputeProjection(result.dispute),
          hwmLedgerEntryId: result.hwmLedgerEntryId,
        },
        runtime.kind,
      );
    }

    return adminClientError(400, "UNKNOWN_COMMAND", `Unknown command: ${command}`);
  } catch (err) {
    return mapServiceError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}

type ReportingPeriodCommandBody = {
  command?: string;
  organization_id?: string;
  exchange_account_id?: string;
  period_id?: string;
  period_start?: string;
  period_end?: string;
  starting_equity?: string;
  ending_equity?: string;
  starting_snapshot_at?: string;
  ending_snapshot_at?: string;
  open_positions_snapshot_ref?: string;
  valuation_source?: string;
  realized_pnl?: string;
  realized_strategy_profit_receipt?: unknown;
  closed_trade_settlements?: unknown;
  reality_dependencies?: unknown;
  unrealized_pnl?: string;
  net_deposits?: string;
  net_withdrawals?: string;
  computed_at?: string;
};

function refuseNakedRealizedPnlResponse(): AdminRouteHandlerResult {
  return adminClientError(400, NAKED_REALIZED_PNL_REFUSED, NAKED_REALIZED_PNL_REFUSED);
}

function parseCanonicalProfitEvidence(body: ReportingPeriodCommandBody):
  | {
      receipt: RealizedStrategyProfitReceiptV2;
      settlements: readonly ClosedTradeSettlementV2[];
      realityDependencies: BillingRealityDependenciesV1;
    }
  | AdminRouteHandlerResult {
  if (Object.prototype.hasOwnProperty.call(body, "realized_pnl")) {
    return refuseNakedRealizedPnlResponse();
  }
  const receipt = body.realized_strategy_profit_receipt;
  const settlements = body.closed_trade_settlements;
  if (receipt == null || typeof receipt !== "object" || Array.isArray(receipt)) {
    return refuseNakedRealizedPnlResponse();
  }
  if (
    !Array.isArray(settlements) ||
    settlements.some((row) => row == null || typeof row !== "object")
  ) {
    return refuseNakedRealizedPnlResponse();
  }
  return {
    receipt: receipt as RealizedStrategyProfitReceiptV2,
    settlements: settlements as ClosedTradeSettlementV2[],
    realityDependencies: parseBillingRealityDependencies(body.reality_dependencies),
  };
}

function parseReportingPeriodCommandBody(
  raw: unknown,
): ReportingPeriodCommandBody | AdminRouteHandlerResult {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return adminClientError(400, "INVALID_BODY", "Request body must be a JSON object.");
  }
  return raw as ReportingPeriodCommandBody;
}

export async function handleAdminReportingPeriodCommandPost(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return adminClientError(400, "INVALID_BODY", "Expected JSON body.");
  }

  const bodyOrError = parseReportingPeriodCommandBody(parsed);
  if ("status" in bodyOrError) {
    return bodyOrError;
  }
  const body = bodyOrError;

  const organizationId = body.organization_id?.trim();
  if (!organizationId) {
    return adminClientError(400, "ORGANIZATION_ID_REQUIRED", "organization_id is required.");
  }
  try {
    requireOrgContext(organizationId);
  } catch {
    return adminClientError(400, "ORGANIZATION_ID_INVALID", "organization_id is invalid.");
  }

  const command = body.command?.trim();
  if (!command) {
    return adminClientError(400, "COMMAND_REQUIRED", "command is required.");
  }

  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, organizationId, "admin.audit.read");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;

    const context = { ...requireOrgContext(organizationId), userId: auth.userId };
    const orchestrator = createBillingPeriodCloseOrchestrator(runtime);

    if (command === "close-and-materialize") {
      // Account identities are exact text in Reality, including their bytes.
      const exchangeAccountId = body.exchange_account_id;
      if (typeof exchangeAccountId !== "string" || !exchangeAccountId.trim()) {
        return adminClientError(400, "INVALID_BODY", "exchange_account_id is required.");
      }

      const periodStart = parseRequiredDate(body.period_start, "period_start");
      if (!(periodStart instanceof Date)) {
        return periodStart;
      }
      const periodEnd = parseRequiredDate(body.period_end, "period_end");
      if (!(periodEnd instanceof Date)) {
        return periodEnd;
      }
      const startingSnapshotAt = parseRequiredDate(
        body.starting_snapshot_at,
        "starting_snapshot_at",
      );
      if (!(startingSnapshotAt instanceof Date)) {
        return startingSnapshotAt;
      }
      const endingSnapshotAt = parseRequiredDate(body.ending_snapshot_at, "ending_snapshot_at");
      if (!(endingSnapshotAt instanceof Date)) {
        return endingSnapshotAt;
      }

      const startingEquity = parseRequiredString(body.starting_equity, "starting_equity");
      if (typeof startingEquity !== "string") {
        return startingEquity;
      }
      const endingEquity = parseRequiredString(body.ending_equity, "ending_equity");
      if (typeof endingEquity !== "string") {
        return endingEquity;
      }
      const openPositionsSnapshotRef = parseRequiredString(
        body.open_positions_snapshot_ref,
        "open_positions_snapshot_ref",
      );
      if (typeof openPositionsSnapshotRef !== "string") {
        return openPositionsSnapshotRef;
      }
      const valuationSource = parseRequiredString(body.valuation_source, "valuation_source");
      if (typeof valuationSource !== "string") {
        return valuationSource;
      }
      const unrealizedPnl = parseRequiredString(body.unrealized_pnl, "unrealized_pnl");
      if (typeof unrealizedPnl !== "string") {
        return unrealizedPnl;
      }
      const profitEvidence = parseCanonicalProfitEvidence(body);
      if ("status" in profitEvidence) {
        return profitEvidence;
      }

      const closeInput = {
        exchangeAccountId,
        periodStart,
        periodEnd,
        startingEquity,
        endingEquity,
        startingSnapshotAt,
        endingSnapshotAt,
        openPositionsSnapshotRef,
        valuationSource,
        realizedStrategyProfitReceipt: profitEvidence.receipt,
        closedTradeSettlements: profitEvidence.settlements,
        realityDependencies: profitEvidence.realityDependencies,
        unrealizedPnl,
        netDeposits: body.net_deposits?.trim(),
        netWithdrawals: body.net_withdrawals?.trim(),
      };
      // The production close factory owns isolation, source lock and all effects.
      const result = await orchestrator.closeAndMaterialize(context, closeInput);

      return adminSuccess({ result }, runtime.kind);
    }

    if (command === "materialize-draft") {
      const exchangeAccountId = parseRequiredString(
        body.exchange_account_id,
        "exchange_account_id",
      );
      if (typeof exchangeAccountId !== "string") {
        return exchangeAccountId;
      }
      const periodId = parseRequiredString(body.period_id, "period_id");
      if (typeof periodId !== "string") {
        return periodId;
      }

      let computedAt: Date | undefined;
      if (body.computed_at?.trim()) {
        const parsedAt = parseRequiredDate(body.computed_at, "computed_at");
        if (!(parsedAt instanceof Date)) {
          return parsedAt;
        }
        computedAt = parsedAt;
      }

      const result = await orchestrator.materializeDraft(context, {
        exchangeAccountId,
        periodId,
        computedAt,
      });

      return adminSuccess({ result }, runtime.kind);
    }

    return adminClientError(400, "UNKNOWN_COMMAND", `Unknown command: ${command}`);
  } catch (err) {
    return mapServiceError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}
