import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import {
  adminClientError,
  adminSuccess,
  authorizeAdminRoute,
  parseOrganizationId,
  parseOrganizationIdFromUnknown,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/waia-core/permissions/admin-http";
import type { TreasuryAdminPermission } from "@/lib/waia-core/permissions/resolve";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import {
  mapTreasuryHttpError,
  treasuryBackendUnavailable,
} from "@/lib/waia-core/treasury/admin/errors";
import {
  asObject,
  parseBoundedLimit,
  parseBoundedOffset,
  parseBudgetStatus,
  parseDetailPublication,
  parseFundingNeedStatus,
  parseSemanticPatch,
  parseTxDirection,
  parseTxKind,
  parseTxStatus,
  parsePositiveDecimalBigint,
  rejectBudgetAggregates,
  rejectCustodyMaterial,
  rejectFundedAmount,
  rejectWatchedImmutableIdentity,
  rejectWatcherEnablement,
  requireBoolean,
  requireIsoDate,
  requireInt,
  requireString,
  optionalString,
} from "@/lib/waia-core/treasury/admin/parse";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import {
  serializeAttribution,
  serializeBudget,
  serializeCommitment,
  serializeEvidenceLink,
  serializeEvidenceObject,
  serializeFundingNeed,
  serializeIdealBudget,
  serializeInception,
  serializeReconciliation,
  serializeRunwayPlan,
  serializeSettings,
  serializeTransaction,
  serializeTransactionDetail,
  serializeWatchedAddress,
} from "@/lib/waia-core/treasury/admin/serialize";
import {
  openProductionTreasuryAdmin,
  type TreasuryAdminServices,
} from "@/lib/waia-core/treasury/admin/services";
import type { TreasuryActorContext } from "@/lib/waia-core/treasury/types";

export type TreasuryAdminHandlerDeps = AdminRouteHandlerDeps & {
  openTreasuryServices?: (
    runtime: WaiaRuntimeDb,
  ) =>
    | TreasuryAdminServices
    | AdminRouteHandlerResult
    | Promise<TreasuryAdminServices | AdminRouteHandlerResult>;
  testPermissionGate?: (input: {
    userId: string;
    organizationId: string;
    permission: string;
  }) => boolean;
};

function actor(userId: string): TreasuryActorContext {
  return { actorType: "admin", actorUserId: userId };
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new Error("INVALID_JSON");
  }
  return asObject(raw);
}

async function withTreasuryAdmin(input: {
  deps: TreasuryAdminHandlerDeps;
  organizationId: string;
  permission: TreasuryAdminPermission;
  fn: (ctx: {
    userId: string;
    organizationId: string;
    services: TreasuryAdminServices;
  }) => Promise<AdminRouteHandlerResult>;
}): Promise<AdminRouteHandlerResult> {
  let runtime: WaiaRuntimeDb | undefined;
  try {
    let userId: string;
    if (input.deps.testPermissionGate) {
      const sessionUserId = await input.deps.getUserId();
      if (!sessionUserId) {
        return adminClientError(401, "UNAUTHORIZED", "Sign in required.");
      }
      runtime = await input.deps.getRuntimeDb();
      const allowed = input.deps.testPermissionGate({
        userId: sessionUserId,
        organizationId: input.organizationId,
        permission: input.permission,
      });
      if (!allowed) {
        return adminClientError(403, "FORBIDDEN", "Admin permission required.");
      }
      userId = sessionUserId;
    } else {
      const auth = await authorizeAdminRoute(input.deps, input.organizationId, input.permission);
      if (!auth.ok) return auth.result;
      runtime = auth.runtime;
      userId = auth.userId;
    }

    const opened = input.deps.openTreasuryServices
      ? await input.deps.openTreasuryServices(runtime)
      : openProductionTreasuryAdmin(runtime);
    if ("status" in opened) return opened;
    return await input.fn({
      userId,
      organizationId: input.organizationId,
      services: opened,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  } finally {
    if (runtime) await input.deps.disposeRuntimeDb(runtime);
  }
}

function orgFromQuery(request: Request): string | AdminRouteHandlerResult {
  return parseOrganizationId(new URL(request.url));
}

export async function handleTreasuryTransactionsGet(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const organizationId = orgFromQuery(request);
  if (typeof organizationId !== "string") return organizationId;
  const url = new URL(request.url);
  return withTreasuryAdmin({
    deps,
    organizationId,
    permission: "admin.treasury.read",
    fn: async ({ services }) => {
      const context = requireOrgContext(organizationId);
      const id = url.searchParams.get("id")?.trim();
      if (id) {
        const tx = await services.domain.repository.getTransaction(context, id);
        if (!tx) {
          return adminClientError(404, "TREASURY_NOT_FOUND", "transaction not found");
        }
        const [observations, revisions, evidenceLinks, attributions] = await Promise.all([
          services.domain.repository.listLinkedObservations(context, id),
          services.domain.repository.listRevisions(context, id),
          services.domain.repository.listEvidenceLinks(context, id),
          services.domain.repository.listAttributions(context, id),
        ]);
        return adminSuccess(
          serializeTransactionDetail({
            transaction: tx,
            observations,
            revisions,
            evidenceLinks,
            attributions,
          }),
        );
      }
      const rows = await services.domain.repository.listTransactions(context, {
        status: url.searchParams.get("status")
          ? parseTxStatus(url.searchParams.get("status"))
          : undefined,
        detailPublication: url.searchParams.get("detail_publication")
          ? parseDetailPublication(url.searchParams.get("detail_publication"))
          : undefined,
        kind: url.searchParams.get("kind") ? parseTxKind(url.searchParams.get("kind")) : undefined,
        limit: parseBoundedLimit(url.searchParams.get("limit"), 50, 100),
        offset: parseBoundedOffset(url.searchParams.get("offset")),
      });
      return adminSuccess({ transactions: rows.map(serializeTransaction) });
    },
  });
}

export async function handleTreasuryTransactionByIdGet(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
  transactionId: string,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  if (!url.searchParams.get("id")) {
    url.searchParams.set("id", transactionId);
  }
  return handleTreasuryTransactionsGet(new Request(url, request), deps);
}

export async function handleTreasuryTransactionsPost(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    rejectWatcherEnablement(body);
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const context = requireOrgContext(organizationId);
        const created = await services.domain.transactions.createManualDraft(
          context,
          actor(userId),
          {
            direction: parseTxDirection(body.direction),
            kind: body.kind === undefined || body.kind === null ? null : parseTxKind(body.kind),
            nativeAmountAtomic: parsePositiveDecimalBigint(
              body.native_amount_atomic ?? body.nativeAmountAtomic,
              "native_amount_atomic",
            ),
            nativeDecimals: requireInt(
              body.native_decimals ?? body.nativeDecimals ?? 6,
              "native_decimals",
            ),
            nativeAsset: requireString(body.native_asset ?? body.nativeAsset, "native_asset"),
            nativeContract: optionalString(
              body.native_contract ?? body.nativeContract,
              "native_contract",
            ),
            accountingAmountMicros:
              body.accounting_amount_micros !== undefined ||
              body.accountingAmountMicros !== undefined
                ? parsePositiveDecimalBigint(
                    body.accounting_amount_micros ?? body.accountingAmountMicros,
                    "accounting_amount_micros",
                  )
                : null,
            occurredAt: requireIsoDate(body.occurred_at ?? body.occurredAt, "occurred_at"),
            purpose: optionalString(body.purpose, "purpose"),
            budgetId:
              body.budget_id === undefined && body.budgetId === undefined
                ? null
                : optionalString(body.budget_id ?? body.budgetId, "budget_id"),
            fundingNeedId:
              body.funding_need_id === undefined && body.fundingNeedId === undefined
                ? null
                : optionalString(body.funding_need_id ?? body.fundingNeedId, "funding_need_id"),
            correctsTransactionId:
              body.corrects_transaction_id === undefined && body.correctsTransactionId === undefined
                ? null
                : optionalString(
                    body.corrects_transaction_id ?? body.correctsTransactionId,
                    "corrects_transaction_id",
                  ),
            reason: requireString(body.reason, "reason"),
          },
        );
        return adminSuccess({ transaction: serializeTransaction(created) });
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryTransactionCommandsPost(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    rejectWatcherEnablement(body);
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    const command = requireString(body.command, "command");
    const patch = command === "classify" ? parseSemanticPatch(body.patch ?? {}) : undefined;
    const permission: TreasuryAdminPermission =
      command === "set_detail_publication" || patch?.publishCounterparty === true
        ? "admin.treasury.publish"
        : "admin.treasury.mutate";
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission,
      fn: async ({ userId, services }) => {
        const context = requireOrgContext(organizationId);
        const admin = actor(userId);
        const reason = requireString(body.reason, "reason");
        const txId = () =>
          requireString(body.transaction_id ?? body.transactionId, "transaction_id");
        switch (command) {
          case "submit_for_review": {
            const tx = await services.domain.transactions.submitForReview(context, admin, {
              transactionId: txId(),
              reason,
            });
            return adminSuccess({ transaction: serializeTransaction(tx) });
          }
          case "classify": {
            const tx = await services.domain.transactions.classify(context, admin, {
              transactionId: txId(),
              reason,
              patch: patch ?? {},
            });
            return adminSuccess({ transaction: serializeTransaction(tx) });
          }
          case "verify": {
            const tx = await services.domain.transactions.verify(context, admin, {
              transactionId: txId(),
              reason,
            });
            return adminSuccess({ transaction: serializeTransaction(tx) });
          }
          case "reject": {
            const tx = await services.domain.transactions.reject(context, admin, {
              transactionId: txId(),
              reason,
            });
            return adminSuccess({ transaction: serializeTransaction(tx) });
          }
          case "confirm_duplicate": {
            const tx = await services.domain.transactions.confirmDuplicate(context, admin, {
              transactionId: txId(),
              duplicateOfTransactionId: requireString(
                body.duplicate_of_transaction_id ?? body.duplicateOfTransactionId,
                "duplicate_of_transaction_id",
              ),
              reason,
            });
            return adminSuccess({ transaction: serializeTransaction(tx) });
          }
          case "reopen_reconciliation": {
            const tx = await services.domain.transactions.reopenReconciliation(context, admin, {
              transactionId: txId(),
              reason,
            });
            return adminSuccess({ transaction: serializeTransaction(tx) });
          }
          case "return_from_reconciliation": {
            const toStatus = requireString(body.to_status ?? body.toStatus, "to_status");
            if (
              toStatus !== "NEEDS_REVIEW" &&
              toStatus !== "REJECTED" &&
              toStatus !== "DUPLICATE" &&
              toStatus !== "VERIFIED"
            ) {
              return adminClientError(400, "INVALID_ENUM", "to_status is not permitted");
            }
            const tx = await services.domain.transactions.returnFromReconciliation(context, admin, {
              transactionId: txId(),
              toStatus,
              reason,
              duplicateOfTransactionId:
                typeof (body.duplicate_of_transaction_id ?? body.duplicateOfTransactionId) ===
                "string"
                  ? String(body.duplicate_of_transaction_id ?? body.duplicateOfTransactionId)
                  : undefined,
            });
            return adminSuccess({ transaction: serializeTransaction(tx) });
          }
          case "set_detail_publication": {
            const tx = await services.domain.transactions.setDetailPublication(context, admin, {
              transactionId: txId(),
              detailPublication: parseDetailPublication(
                body.detail_publication ?? body.detailPublication,
              ),
              reason,
              supersededById:
                body.superseded_by_id === undefined && body.supersededById === undefined
                  ? undefined
                  : optionalString(
                      body.superseded_by_id ?? body.supersededById,
                      "superseded_by_id",
                    ),
            });
            return adminSuccess({ transaction: serializeTransaction(tx) });
          }
          case "link_correction": {
            const tx = await services.domain.transactions.linkCorrection(context, admin, {
              originalTransactionId: requireString(
                body.original_transaction_id ?? body.originalTransactionId,
                "original_transaction_id",
              ),
              correctionTransactionId: requireString(
                body.correction_transaction_id ?? body.correctionTransactionId,
                "correction_transaction_id",
              ),
              reason,
            });
            return adminSuccess({ transaction: serializeTransaction(tx) });
          }
          default:
            return adminClientError(400, "UNKNOWN_COMMAND", "Unknown transaction command");
        }
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryCommitmentsGet(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const organizationId = orgFromQuery(request);
  if (typeof organizationId !== "string") return organizationId;
  return withTreasuryAdmin({
    deps,
    organizationId,
    permission: "admin.treasury.read",
    fn: async ({ services }) => {
      const rows = await services.domain.repository.listCommitments(
        requireOrgContext(organizationId),
      );
      return adminSuccess({ commitments: rows.map(serializeCommitment) });
    },
  });
}

export async function handleTreasuryCommitmentsPost(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    rejectWatcherEnablement(body);
    rejectKeysCommitted(body);
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const created = await services.domain.commitments.createDraft(
          requireOrgContext(organizationId),
          actor(userId),
          {
            amountMicros: parsePositiveDecimalBigint(
              body.amount_micros ?? body.amountMicros,
              "amount_micros",
            ),
            currency: optionalString(body.currency, "currency") ?? "USD",
            purpose: requireString(body.purpose, "purpose"),
            budgetId: optionalString(body.budget_id ?? body.budgetId, "budget_id"),
            reason: requireString(body.reason, "reason"),
          },
        );
        return adminSuccess({ commitment: serializeCommitment(created) });
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

function rejectKeysCommitted(body: Record<string, unknown>) {
  if (body.committed !== undefined || body.committed_amount_micros !== undefined) {
    throw new TreasuryValidationError(
      "AGGREGATE_NOT_AUTHORITY",
      "committed funds are derived and cannot be admin-maintained",
    );
  }
}

export async function handleTreasuryCommitmentCommandsPost(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    rejectWatcherEnablement(body);
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    const command = requireString(body.command, "command");
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const context = requireOrgContext(organizationId);
        const admin = actor(userId);
        const commitmentId = requireString(
          body.commitment_id ?? body.commitmentId,
          "commitment_id",
        );
        const reason = requireString(body.reason, "reason");
        switch (command) {
          case "approve":
            return adminSuccess({
              commitment: serializeCommitment(
                await services.domain.commitments.approve(context, admin, { commitmentId, reason }),
              ),
            });
          case "release":
            return adminSuccess({
              commitment: serializeCommitment(
                await services.domain.commitments.release(context, admin, { commitmentId, reason }),
              ),
            });
          case "fulfill":
            return adminSuccess({
              commitment: serializeCommitment(
                await services.domain.commitments.fulfill(context, admin, {
                  commitmentId,
                  fulfillsTransactionId: requireString(
                    body.fulfills_transaction_id ?? body.fulfillsTransactionId,
                    "fulfills_transaction_id",
                  ),
                  reason,
                }),
              ),
            });
          case "cancel":
            return adminSuccess({
              commitment: serializeCommitment(
                await services.domain.commitments.cancel(context, admin, { commitmentId, reason }),
              ),
            });
          default:
            return adminClientError(400, "UNKNOWN_COMMAND", "Unknown commitment command");
        }
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryWatchedAddressesGet(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const organizationId = orgFromQuery(request);
  if (typeof organizationId !== "string") return organizationId;
  return withTreasuryAdmin({
    deps,
    organizationId,
    permission: "admin.treasury.read",
    fn: async ({ services }) => {
      const rows = await services.catalog.listWatchedAddresses(requireOrgContext(organizationId));
      return adminSuccess({ watchedAddresses: rows.map(serializeWatchedAddress) });
    },
  });
}

export async function handleTreasuryWatchedAddressesPost(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    rejectWatcherEnablement(body);
    rejectCustodyMaterial(body);
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const created = await services.catalog.createWatchedAddress(
          requireOrgContext(organizationId),
          actor(userId),
          {
            network: requireString(body.network, "network"),
            address: requireString(body.address, "address"),
            tokenContract: requireString(
              body.token_contract ?? body.tokenContract,
              "token_contract",
            ),
            assetCode: requireString(body.asset_code ?? body.assetCode, "asset_code"),
            directionScope: requireString(
              body.direction_scope ?? body.directionScope,
              "direction_scope",
            ),
            includeInBalanceRecon: requireBoolean(
              body.include_in_balance_recon ?? body.includeInBalanceRecon ?? true,
              "include_in_balance_recon",
            ),
            label: requireString(body.label, "label"),
            reason: requireString(body.reason, "reason"),
          },
        );
        return adminSuccess({ watchedAddress: serializeWatchedAddress(created) });
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryWatchedAddressesPatch(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    rejectWatcherEnablement(body);
    rejectCustodyMaterial(body);
    rejectWatchedImmutableIdentity(body);
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const updated = await services.catalog.updateWatchedAddress(
          requireOrgContext(organizationId),
          actor(userId),
          requireString(body.id, "id"),
          {
            directionScope:
              body.direction_scope !== undefined || body.directionScope !== undefined
                ? (requireString(body.direction_scope ?? body.directionScope, "direction_scope") as
                    | "INBOUND"
                    | "OUTBOUND"
                    | "BOTH")
                : undefined,
            includeInBalanceRecon:
              body.include_in_balance_recon !== undefined ||
              body.includeInBalanceRecon !== undefined
                ? requireBoolean(
                    body.include_in_balance_recon ?? body.includeInBalanceRecon,
                    "include_in_balance_recon",
                  )
                : undefined,
            label: body.label !== undefined ? requireString(body.label, "label") : undefined,
            isActive:
              body.is_active !== undefined || body.isActive !== undefined
                ? requireBoolean(body.is_active ?? body.isActive, "is_active")
                : undefined,
          },
          requireString(body.reason, "reason"),
        );
        return adminSuccess({ watchedAddress: serializeWatchedAddress(updated) });
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryBudgetsGet(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const organizationId = orgFromQuery(request);
  if (typeof organizationId !== "string") return organizationId;
  return withTreasuryAdmin({
    deps,
    organizationId,
    permission: "admin.treasury.read",
    fn: async ({ services }) => {
      const rows = await services.catalog.listBudgets(requireOrgContext(organizationId));
      return adminSuccess({ budgets: rows.map(serializeBudget) });
    },
  });
}

export async function handleTreasuryBudgetsPost(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    rejectBudgetAggregates(body);
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const created = await services.catalog.createBudget(
          requireOrgContext(organizationId),
          actor(userId),
          {
            code: requireString(body.code, "code"),
            title: requireString(body.title, "title"),
            periodStart: requireString(body.period_start ?? body.periodStart, "period_start"),
            periodEnd: requireString(body.period_end ?? body.periodEnd, "period_end"),
            currency: requireString(body.currency, "currency"),
            plannedAmountMicros: parsePositiveDecimalBigint(
              body.planned_amount_micros ?? body.plannedAmountMicros,
              "planned_amount_micros",
            ),
            status: parseBudgetStatus(body.status ?? "DRAFT"),
            notes: optionalString(body.notes, "notes"),
            isPublic: body.is_public === true || body.isPublic === true,
            reason: requireString(body.reason, "reason"),
          },
        );
        return adminSuccess({ budget: serializeBudget(created) });
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryBudgetsPatch(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    rejectBudgetAggregates(body);
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    const publish = body.is_public !== undefined || body.isPublic !== undefined;
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: publish ? "admin.treasury.publish" : "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const updated = await services.catalog.updateBudget(
          requireOrgContext(organizationId),
          actor(userId),
          requireString(body.id, "id"),
          {
            title: body.title !== undefined ? requireString(body.title, "title") : undefined,
            notes: body.notes !== undefined ? optionalString(body.notes, "notes") : undefined,
            status: body.status !== undefined ? parseBudgetStatus(body.status) : undefined,
            plannedAmountMicros:
              body.planned_amount_micros !== undefined || body.plannedAmountMicros !== undefined
                ? parsePositiveDecimalBigint(
                    body.planned_amount_micros ?? body.plannedAmountMicros,
                    "planned_amount_micros",
                  )
                : undefined,
            isPublic: publish
              ? requireBoolean(body.is_public ?? body.isPublic, "is_public")
              : undefined,
          },
          requireString(body.reason, "reason"),
          publish ? "publish" : "mutate",
        );
        return adminSuccess({ budget: serializeBudget(updated) });
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryFundingNeedsGet(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const organizationId = orgFromQuery(request);
  if (typeof organizationId !== "string") return organizationId;
  return withTreasuryAdmin({
    deps,
    organizationId,
    permission: "admin.treasury.read",
    fn: async ({ services }) => {
      const rows = await services.catalog.listFundingNeeds(requireOrgContext(organizationId));
      return adminSuccess({ fundingNeeds: rows.map(serializeFundingNeed) });
    },
  });
}

export async function handleTreasuryFundingNeedsPost(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    rejectFundedAmount(body);
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const created = await services.catalog.createFundingNeed(
          requireOrgContext(organizationId),
          actor(userId),
          {
            title: requireString(body.title, "title"),
            publicExplanation: optionalString(
              body.public_explanation ?? body.publicExplanation,
              "public_explanation",
            ),
            targetStage: optionalString(body.target_stage ?? body.targetStage, "target_stage"),
            requiredAmountMicros: parsePositiveDecimalBigint(
              body.required_amount_micros ?? body.requiredAmountMicros,
              "required_amount_micros",
            ),
            currency: requireString(body.currency, "currency"),
            status: parseFundingNeedStatus(body.status ?? "OPEN"),
            budgetId: optionalString(body.budget_id ?? body.budgetId, "budget_id"),
            isPublic: body.is_public === true || body.isPublic === true,
            reason: requireString(body.reason, "reason"),
          },
        );
        return adminSuccess({ fundingNeed: serializeFundingNeed(created) });
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryFundingNeedsPatch(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    rejectFundedAmount(body);
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    const publish = body.is_public !== undefined || body.isPublic !== undefined;
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: publish ? "admin.treasury.publish" : "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const updated = await services.catalog.updateFundingNeed(
          requireOrgContext(organizationId),
          actor(userId),
          requireString(body.id, "id"),
          {
            title: body.title !== undefined ? requireString(body.title, "title") : undefined,
            status: body.status !== undefined ? parseFundingNeedStatus(body.status) : undefined,
            requiredAmountMicros:
              body.required_amount_micros !== undefined || body.requiredAmountMicros !== undefined
                ? parsePositiveDecimalBigint(
                    body.required_amount_micros ?? body.requiredAmountMicros,
                    "required_amount_micros",
                  )
                : undefined,
            isPublic: publish
              ? requireBoolean(body.is_public ?? body.isPublic, "is_public")
              : undefined,
            budgetId:
              body.budget_id !== undefined || body.budgetId !== undefined
                ? optionalString(body.budget_id ?? body.budgetId, "budget_id")
                : undefined,
          },
          requireString(body.reason, "reason"),
          publish ? "publish" : "mutate",
        );
        return adminSuccess({ fundingNeed: serializeFundingNeed(updated) });
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryIdealBudgetsGet(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const organizationId = orgFromQuery(request);
  if (typeof organizationId !== "string") return organizationId;
  return withTreasuryAdmin({
    deps,
    organizationId,
    permission: "admin.treasury.read",
    fn: async ({ services }) => {
      const rows = await services.catalog.listIdealBudgets(requireOrgContext(organizationId));
      return adminSuccess({ idealBudgets: rows.map(serializeIdealBudget) });
    },
  });
}

export async function handleTreasuryIdealBudgetsPost(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    if (body.amount_micros === undefined && body.amountMicros === undefined) {
      return adminClientError(400, "AMOUNT_REQUIRED", "ideal amount must be supplied explicitly");
    }
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const created = await services.catalog.createIdealBudget(
          requireOrgContext(organizationId),
          actor(userId),
          {
            periodYear: requireInt(body.period_year ?? body.periodYear, "period_year"),
            currency: requireString(body.currency, "currency"),
            amountMicros: parsePositiveDecimalBigint(
              body.amount_micros ?? body.amountMicros,
              "amount_micros",
            ),
            reason: requireString(body.reason, "reason"),
          },
        );
        return adminSuccess({ idealBudget: serializeIdealBudget(created) });
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryIdealBudgetCommandsPost(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    const command = requireString(body.command, "command");
    if (command !== "activate_public") {
      return adminClientError(400, "UNKNOWN_COMMAND", "Unknown ideal-budget command");
    }
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.publish",
      fn: async ({ userId, services }) => {
        const updated = await services.catalog.activatePublicIdealBudget(
          requireOrgContext(organizationId),
          actor(userId),
          requireString(body.id, "id"),
          requireString(body.reason, "reason"),
        );
        return adminSuccess({ idealBudget: serializeIdealBudget(updated) });
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryRunwayPlansGet(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const organizationId = orgFromQuery(request);
  if (typeof organizationId !== "string") return organizationId;
  return withTreasuryAdmin({
    deps,
    organizationId,
    permission: "admin.treasury.read",
    fn: async ({ services }) => {
      const rows = await services.catalog.listRunwayPlans(requireOrgContext(organizationId));
      return adminSuccess({
        runwayPlans: rows.map(serializeRunwayPlan),
        runwaySnapshots: [],
      });
    },
  });
}

export async function handleTreasuryRunwayPlansPost(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    if (body.infer_from_history === true || body.historical_burn !== undefined) {
      return adminClientError(400, "BURN_NOT_INFERRED", "daily burn must be supplied explicitly");
    }
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const created = await services.catalog.createRunwayDraft(
          requireOrgContext(organizationId),
          actor(userId),
          {
            currency: requireString(body.currency, "currency"),
            dailyBurnMicros: parsePositiveDecimalBigint(
              body.daily_burn_micros ?? body.dailyBurnMicros,
              "daily_burn_micros",
            ),
            reason: requireString(body.reason, "reason"),
          },
        );
        return adminSuccess({ runwayPlan: serializeRunwayPlan(created) });
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryRunwayPlanCommandsPost(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    if (requireString(body.command, "command") !== "activate") {
      return adminClientError(400, "UNKNOWN_COMMAND", "Unknown runway-plan command");
    }
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.publish",
      fn: async ({ userId, services }) => {
        const updated = await services.catalog.activateRunwayPlan(
          requireOrgContext(organizationId),
          actor(userId),
          requireString(body.id, "id"),
          requireString(body.reason, "reason"),
        );
        return adminSuccess({ runwayPlan: serializeRunwayPlan(updated) });
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryAttributionsGet(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const organizationId = orgFromQuery(request);
  if (typeof organizationId !== "string") return organizationId;
  return withTreasuryAdmin({
    deps,
    organizationId,
    permission: "admin.treasury.read",
    fn: async ({ services }) => {
      const rows = await services.catalog.listAttributions(requireOrgContext(organizationId));
      return adminSuccess({ attributions: rows.map(serializeAttribution) });
    },
  });
}

export async function handleTreasuryAttributionsPost(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const created = await services.catalog.createAttribution(
          requireOrgContext(organizationId),
          actor(userId),
          {
            transactionId: requireString(
              body.transaction_id ?? body.transactionId,
              "transaction_id",
            ),
            status: requireString(body.status, "status"),
            contributorUserId: optionalString(
              body.contributor_user_id ?? body.contributorUserId,
              "contributor_user_id",
            ),
            consentPublicIdentity:
              body.consent_public_identity === true || body.consentPublicIdentity === true,
            note: optionalString(body.note, "note"),
            reason: requireString(body.reason, "reason"),
          },
        );
        return adminSuccess({ attribution: serializeAttribution(created) });
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryEvidenceGet(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const organizationId = orgFromQuery(request);
  if (typeof organizationId !== "string") return organizationId;
  const url = new URL(request.url);
  return withTreasuryAdmin({
    deps,
    organizationId,
    permission: "admin.treasury.read",
    fn: async ({ services }) => {
      const context = requireOrgContext(organizationId);
      const id = url.searchParams.get("id")?.trim();
      if (id) {
        const row = await services.catalog.getEvidence(context, id);
        if (!row) return adminClientError(404, "TREASURY_NOT_FOUND", "evidence not found");
        return adminSuccess({ evidence: serializeEvidenceObject(row) });
      }
      const rows = await services.catalog.listEvidence(context);
      return adminSuccess({ evidence: rows.map(serializeEvidenceObject) });
    },
  });
}

export async function handleTreasuryEvidencePost(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    const visibility = body.visibility;
    if (visibility !== undefined) {
      const permission: TreasuryAdminPermission =
        visibility === "PUBLIC" ? "admin.treasury.publish" : "admin.treasury.mutate";
      return withTreasuryAdmin({
        deps,
        organizationId,
        permission,
        fn: async ({ userId, services }) => {
          const updated = await services.catalog.setEvidenceVisibility(
            requireOrgContext(organizationId),
            actor(userId),
            requireString(body.id, "id"),
            requireString(visibility, "visibility"),
            requireString(body.reason, "reason"),
          );
          return adminSuccess({ evidence: serializeEvidenceObject(updated) });
        },
      });
    }
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.mutate",
      fn: async ({ services }) => {
        services.catalog.refuseCreateEvidenceObject();
        return treasuryBackendUnavailable();
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryEvidenceLinksPost(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    const command = requireString(body.command ?? body.action, "command");
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const context = requireOrgContext(organizationId);
        const admin = actor(userId);
        const reason = requireString(body.reason, "reason");
        if (command === "link") {
          const link = await services.catalog.linkEvidence(context, admin, {
            transactionId: requireString(
              body.transaction_id ?? body.transactionId,
              "transaction_id",
            ),
            evidenceObjectId: requireString(
              body.evidence_object_id ?? body.evidenceObjectId,
              "evidence_object_id",
            ),
            reason,
          });
          return adminSuccess({ link: serializeEvidenceLink(link) });
        }
        if (command === "unlink") {
          await services.catalog.unlinkEvidence(context, admin, {
            linkId: requireString(body.link_id ?? body.linkId, "link_id"),
            reason,
          });
          return adminSuccess({ unlinked: true });
        }
        return adminClientError(400, "UNKNOWN_COMMAND", "Unknown evidence-link command");
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryInceptionsGet(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const organizationId = orgFromQuery(request);
  if (typeof organizationId !== "string") return organizationId;
  const url = new URL(request.url);
  return withTreasuryAdmin({
    deps,
    organizationId,
    permission: "admin.treasury.read",
    fn: async ({ services }) => {
      const network = url.searchParams.get("network")?.trim();
      const tokenContract = url.searchParams.get("token_contract")?.trim();
      if (!network || !tokenContract) {
        return adminClientError(400, "INVALID_BODY", "network and token_contract are required");
      }
      const row = await services.domain.inceptions.getActiveInception(
        requireOrgContext(organizationId),
        network,
        tokenContract,
      );
      return adminSuccess({ inception: row ? serializeInception(row) : null });
    },
  });
}

export async function handleTreasuryInceptionsPost(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    rejectWatcherEnablement(body);
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    const command = requireString(body.command ?? "create_active", "command");
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const context = requireOrgContext(organizationId);
        const payload = {
          network: requireString(body.network, "network"),
          tokenContract: requireString(body.token_contract ?? body.tokenContract, "token_contract"),
          assetCode: requireString(body.asset_code ?? body.assetCode, "asset_code"),
          inceptionBlock: requireString(
            body.inception_block ?? body.inceptionBlock,
            "inception_block",
          ),
          watcherStartBlock: requireString(
            body.watcher_start_block ?? body.watcherStartBlock,
            "watcher_start_block",
          ),
          inceptionTime: requireIsoDate(
            body.inception_time ?? body.inceptionTime,
            "inception_time",
          ),
          openingBalanceTransactionId: requireString(
            body.opening_balance_transaction_id ?? body.openingBalanceTransactionId,
            "opening_balance_transaction_id",
          ),
          evidenceObjectId: optionalString(
            body.evidence_object_id ?? body.evidenceObjectId,
            "evidence_object_id",
          ),
          reason: requireString(body.reason, "reason"),
        };
        if (command === "create_active") {
          const created = await services.domain.inceptions.createActive(
            context,
            actor(userId),
            payload,
          );
          return adminSuccess({ inception: serializeInception(created) });
        }
        if (command === "replace_active") {
          const created = await services.domain.inceptions.replaceActive(context, actor(userId), {
            ...payload,
            supersedeInceptionId: requireString(
              body.supersede_inception_id ?? body.supersedeInceptionId,
              "supersede_inception_id",
            ),
          });
          return adminSuccess({ inception: serializeInception(created) });
        }
        return adminClientError(400, "UNKNOWN_COMMAND", "Unknown inception command");
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryReconciliationsGet(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const organizationId = orgFromQuery(request);
  if (typeof organizationId !== "string") return organizationId;
  const url = new URL(request.url);
  return withTreasuryAdmin({
    deps,
    organizationId,
    permission: "admin.treasury.read",
    fn: async ({ services }) => {
      const rows = await services.watcher.listBalanceReconciliations(
        requireOrgContext(organizationId),
      );
      const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (url.searchParams.get("latest") === "true") {
        return adminSuccess({
          reconciliation: sorted[0] ? serializeReconciliation(sorted[0]) : null,
        });
      }
      const limit = parseBoundedLimit(url.searchParams.get("limit"), 20, 50);
      return adminSuccess({
        reconciliations: sorted.slice(0, limit).map(serializeReconciliation),
      });
    },
  });
}

export async function handleTreasuryReconciliationsPatch(): Promise<AdminRouteHandlerResult> {
  return adminClientError(
    405,
    "RECONCILIATION_IMMUTABLE",
    "Balance reconciliation status is not admin-editable",
  );
}

export async function handleTreasurySettingsGet(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const organizationId = orgFromQuery(request);
  if (typeof organizationId !== "string") return organizationId;
  return withTreasuryAdmin({
    deps,
    organizationId,
    permission: "admin.treasury.read",
    fn: async ({ services }) => {
      const row = await services.catalog.getSettings(requireOrgContext(organizationId));
      return adminSuccess({ settings: row ? serializeSettings(row) : null });
    },
  });
}

export async function handleTreasurySettingsPatch(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    const organizationId = parseOrganizationIdFromUnknown(body.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    const publish = body.breath_enabled !== undefined || body.breathEnabled !== undefined;
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: publish ? "admin.treasury.publish" : "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const updated = await services.catalog.updateSettings(
          requireOrgContext(organizationId),
          actor(userId),
          {
            breathEnabled: publish
              ? requireBoolean(body.breath_enabled ?? body.breathEnabled, "breath_enabled")
              : undefined,
            stageLabel:
              body.stage_label !== undefined || body.stageLabel !== undefined
                ? optionalString(body.stage_label ?? body.stageLabel, "stage_label")
                : undefined,
            workSummary:
              body.work_summary !== undefined || body.workSummary !== undefined
                ? optionalString(body.work_summary ?? body.workSummary, "work_summary")
                : undefined,
            methodologyNote:
              body.methodology_note !== undefined || body.methodologyNote !== undefined
                ? requireString(body.methodology_note ?? body.methodologyNote, "methodology_note")
                : undefined,
            recentActivityLimit:
              body.recent_activity_limit !== undefined || body.recentActivityLimit !== undefined
                ? requireInt(
                    body.recent_activity_limit ?? body.recentActivityLimit,
                    "recent_activity_limit",
                  )
                : undefined,
            reason: requireString(body.reason, "reason"),
          },
          publish ? "publish" : "mutate",
        );
        return adminSuccess({ settings: serializeSettings(updated) });
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_JSON") {
      return adminClientError(400, "INVALID_BODY", "JSON object required.");
    }
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryBreathPreviewGet(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const organizationId = orgFromQuery(request);
  if (typeof organizationId !== "string") return organizationId;
  return withTreasuryAdmin({
    deps,
    organizationId,
    permission: "admin.treasury.read",
    fn: async ({ services }) => {
      await services.breath.getAdminPreview(requireOrgContext(organizationId));
      return adminSuccess({ preview: null });
    },
  });
}

export { treasuryBackendUnavailable };
