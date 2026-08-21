import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { organizations } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import { treasuryAccountKindEnum } from "@/db/core-enums";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import {
  adminClientError,
  adminSuccess,
  adminSuccessBinary,
  assertAdminPermission,
  authorizeAdminRoute,
  parseOrganizationId,
  parseOrganizationIdFromUnknown,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/waia-core/permissions/admin-http";
import type { TreasuryAdminPermission } from "@/lib/waia-core/permissions/resolve";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import {
  mapTreasuryHttpError,
  treasuryBackendUnavailable,
} from "@/lib/waia-core/treasury/admin/errors";
import {
  asObject,
  parseBoundedLimit,
  parseBudgetStatus,
  parseDetailPublication,
  parseEvidenceKind,
  parseEvidenceVisibility,
  parseFundingNeedStatus,
  parseSemanticPatch,
  parseTreasuryTransactionListQuery,
  parseTxDirection,
  parseTxKind,
  parsePositiveDecimalBigint,
  parseNonnegativeDecimalBigint,
  parseNonzeroSignedDecimalBigint,
  parseEnum,
  rejectBudgetAggregates,
  rejectCustodyMaterial,
  rejectEvidenceClientStorageAuthority,
  rejectFundedAmount,
  rejectRunwaySnapshotInjection,
  rejectWatchedImmutableIdentity,
  rejectWatcherEnablement,
  requireBoolean,
  requireIsoDate,
  requireInt,
  requireString,
  optionalString,
} from "@/lib/waia-core/treasury/admin/parse";
import {
  serializeAccountDetail,
  serializeAccountSummary,
  serializeCategory,
  serializeCounterpartyDetail,
  serializeCounterpartySummary,
  serializeProject,
} from "@/lib/waia-core/treasury/admin/ledger-catalog-serialize";
import type { TreasuryLedgerCatalogQuery } from "@/lib/waia-core/treasury/admin/ledger-catalog-types";
import {
  deriveBudgetAdminTotals,
  deriveFundingNeedAdminTotals,
} from "@/lib/waia-core/treasury/admin/derived-reads";
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
  serializeRunwaySnapshot,
  serializeSettings,
  serializeTransaction,
  serializeTransactionDetail,
  serializeWatchedAddress,
} from "@/lib/waia-core/treasury/admin/serialize";
import {
  openProductionTreasuryAdmin,
  type TreasuryAdminServices,
} from "@/lib/waia-core/treasury/admin/services";
import { countTreasuryOverview } from "@/lib/waia-core/treasury/transaction-list-query";
import type { TreasuryActorContext } from "@/lib/waia-core/treasury/types";
import {
  TREASURY_EVIDENCE_DEFAULT_SOURCE,
  TREASURY_EVIDENCE_MAX_UPLOAD_BYTES,
  uploadTreasuryEvidenceObject,
} from "@/lib/waia-core/treasury/evidence";

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
  testListOrganizations?: () => Promise<{ id: string; name: string; kind: string }[]>;
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

async function loadTreasuryAdminFacts(services: TreasuryAdminServices, organizationId: string) {
  const context = requireOrgContext(organizationId);
  const [transactions, commitments] = await Promise.all([
    services.domain.repository.listTransactions(context),
    services.domain.repository.listCommitments(context),
  ]);
  return { transactions, commitments };
}

function compactDefined<T extends Record<string, unknown>>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

async function assertActiveLedgerReferences(
  services: TreasuryAdminServices,
  context: ReturnType<typeof requireOrgContext>,
  refs: {
    counterpartyId?: string | null;
    accountId?: string | null;
    categoryId?: string | null;
    projectId?: string | null;
  },
): Promise<void> {
  const rows = await Promise.all([
    refs.counterpartyId
      ? services.ledgerCatalog.getCounterparty(context, refs.counterpartyId)
      : Promise.resolve(null),
    refs.accountId ? services.ledgerCatalog.getAccount(context, refs.accountId) : null,
    refs.categoryId ? services.ledgerCatalog.getCategory(context, refs.categoryId) : null,
    refs.projectId ? services.ledgerCatalog.getProject(context, refs.projectId) : null,
  ]);
  if (rows.some((row) => row !== null && !row.isActive)) {
    throw new TreasuryValidationError(
      "INACTIVE_REFERENCE",
      "new transaction references must point to active catalog records",
    );
  }
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
      const rows = await services.domain.repository.listTransactions(
        context,
        parseTreasuryTransactionListQuery(url.searchParams),
      );
      return adminSuccess({ transactions: rows.map(serializeTransaction) });
    },
  });
}

export async function handleTreasuryOverviewCountsGet(
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
      const rows = await services.domain.repository.listTransactions(
        requireOrgContext(organizationId),
      );
      return adminSuccess(countTreasuryOverview(rows));
    },
  });
}

export async function handleTreasuryOrganizationsGet(
  _request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const userId = await deps.getUserId();
  if (!userId) {
    return adminClientError(401, "UNAUTHORIZED", "Sign in required.");
  }

  let runtime: WaiaRuntimeDb | undefined;
  try {
    runtime = await deps.getRuntimeDb();
    const contextOrgId = personalOrganizationIdFromUserId(userId);
    if (deps.testPermissionGate) {
      const allowed = deps.testPermissionGate({
        userId,
        organizationId: contextOrgId,
        permission: "admin.treasury.read",
      });
      if (!allowed) {
        return adminClientError(403, "FORBIDDEN", "Admin permission required.");
      }
    } else {
      const check = await assertAdminPermission(
        runtime,
        userId,
        contextOrgId,
        "admin.treasury.read",
      );
      if (!check.allowed) {
        return adminClientError(403, "FORBIDDEN", "Admin permission required.");
      }
    }

    if (deps.testListOrganizations) {
      return adminSuccess({ organizations: await deps.testListOrganizations() });
    }

    if (runtime.kind === "sqlite") {
      const rows = runtime.db
        .select({ id: organizations.id, name: organizations.name, kind: organizations.kind })
        .from(organizations)
        .all();
      return adminSuccess({ organizations: rows }, "sqlite");
    }

    const rows = await runtime.db
      .select({
        id: pgSchema.organizations.id,
        name: pgSchema.organizations.name,
        kind: pgSchema.organizations.kind,
      })
      .from(pgSchema.organizations);
    return adminSuccess({ organizations: rows }, "postgres");
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
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
    rejectCustodyMaterial(body);
    const organizationId = parseOrganizationIdFromUnknown(
      body.organization_id ?? body.organizationId,
    );
    if (typeof organizationId !== "string") return organizationId;
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const context = requireOrgContext(organizationId);
        const signedRaw = body.signed_amount_micros ?? body.signedAmountMicros;
        const hasSignedAmount = signedRaw !== undefined && signedRaw !== null;
        const signedAmount = hasSignedAmount
          ? parseNonzeroSignedDecimalBigint(signedRaw, "signed_amount_micros")
          : null;
        const derivedDirection =
          signedAmount === null
            ? parseTxDirection(body.direction)
            : signedAmount < 0n
              ? "OUTFLOW"
              : "INFLOW";
        if (signedAmount !== null && body.direction !== undefined) {
          const suppliedDirection = parseTxDirection(body.direction);
          if (suppliedDirection !== derivedDirection) {
            throw new TreasuryValidationError(
              "SIGNED_DIRECTION_MISMATCH",
              "direction must match the signed amount",
            );
          }
        }
        const absoluteSigned =
          signedAmount === null ? null : signedAmount < 0n ? -signedAmount : signedAmount;
        const suppliedAccounting =
          body.accounting_amount_micros !== undefined || body.accountingAmountMicros !== undefined
            ? parsePositiveDecimalBigint(
                body.accounting_amount_micros ?? body.accountingAmountMicros,
                "accounting_amount_micros",
              )
            : null;
        if (
          absoluteSigned !== null &&
          suppliedAccounting !== null &&
          suppliedAccounting !== absoluteSigned
        ) {
          throw new TreasuryValidationError(
            "SIGNED_ACCOUNTING_AMOUNT_MISMATCH",
            "signed amount magnitude must equal accounting_amount_micros",
          );
        }
        const statusRaw = body.status;
        let initialStatus: "PLANNED" | "NEEDS_REVIEW" | undefined;
        if (statusRaw !== undefined) {
          const requested = requireString(statusRaw, "status");
          if (requested !== "PLANNED" && requested !== "NEEDS_REVIEW") {
            throw new TreasuryValidationError(
              "STATUS_GATE_REQUIRED",
              "manual creation accepts only PLANNED or NEEDS_REVIEW; verification uses the audited command",
            );
          }
          initialStatus = requested;
        } else if (hasSignedAmount) {
          initialStatus = "NEEDS_REVIEW";
        }
        const refs = {
          counterpartyId: optionalString(
            body.counterparty_id ?? body.counterpartyId,
            "counterparty_id",
          ),
          accountId: optionalString(body.account_id ?? body.accountId, "account_id"),
          categoryId: optionalString(body.category_id ?? body.categoryId, "category_id"),
          projectId: optionalString(body.project_id ?? body.projectId, "project_id"),
        };
        await assertActiveLedgerReferences(services, context, refs);
        const created = await services.domain.transactions.createManualDraft(
          context,
          actor(userId),
          {
            direction: derivedDirection,
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
            accountingAmountMicros: absoluteSigned ?? suppliedAccounting,
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
            ...refs,
            internalNotes: optionalString(
              body.notes ?? body.internal_notes ?? body.internalNotes,
              "notes",
            ),
            initialStatus,
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
            await assertActiveLedgerReferences(services, context, patch ?? {});
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
      const [rows, facts] = await Promise.all([
        services.catalog.listBudgets(requireOrgContext(organizationId)),
        loadTreasuryAdminFacts(services, organizationId),
      ]);
      return adminSuccess({
        budgets: rows.map((row) =>
          serializeBudget(row, deriveBudgetAdminTotals(row, facts.transactions, facts.commitments)),
        ),
      });
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
        const facts = await loadTreasuryAdminFacts(services, organizationId);
        return adminSuccess({
          budget: serializeBudget(
            created,
            deriveBudgetAdminTotals(created, facts.transactions, facts.commitments),
          ),
        });
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
          compactDefined({
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
          }),
          requireString(body.reason, "reason"),
          publish ? "publish" : "mutate",
        );
        const facts = await loadTreasuryAdminFacts(services, organizationId);
        return adminSuccess({
          budget: serializeBudget(
            updated,
            deriveBudgetAdminTotals(updated, facts.transactions, facts.commitments),
          ),
        });
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
      const [rows, facts] = await Promise.all([
        services.catalog.listFundingNeeds(requireOrgContext(organizationId)),
        loadTreasuryAdminFacts(services, organizationId),
      ]);
      return adminSuccess({
        fundingNeeds: rows.map((row) =>
          serializeFundingNeed(row, deriveFundingNeedAdminTotals(row, facts.transactions)),
        ),
      });
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
        const facts = await loadTreasuryAdminFacts(services, organizationId);
        return adminSuccess({
          fundingNeed: serializeFundingNeed(
            created,
            deriveFundingNeedAdminTotals(created, facts.transactions),
          ),
        });
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
          compactDefined({
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
          }),
          requireString(body.reason, "reason"),
          publish ? "publish" : "mutate",
        );
        const facts = await loadTreasuryAdminFacts(services, organizationId);
        return adminSuccess({
          fundingNeed: serializeFundingNeed(
            updated,
            deriveFundingNeedAdminTotals(updated, facts.transactions),
          ),
        });
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
    if (command !== "activate_public" && command !== "refresh_from_categories") {
      return adminClientError(400, "UNKNOWN_COMMAND", "Unknown ideal-budget command");
    }
    if (command === "refresh_from_categories") {
      return withTreasuryAdmin({
        deps,
        organizationId,
        permission: "admin.treasury.mutate",
        fn: async ({ userId, services }) => {
          const context = requireOrgContext(organizationId);
          const periodYear = requireInt(body.period_year ?? body.periodYear, "period_year");
          const currency = requireString(body.currency, "currency");
          const derived = await services.ledgerCatalog.deriveAnnualBudgetMicros(context, currency);
          const created = await services.catalog.createIdealBudget(context, actor(userId), {
            periodYear,
            currency,
            amountMicros: derived.amountMicros,
            reason: requireString(body.reason, "reason"),
            sourceMetadata: {
              source: "TREASURY_CATEGORIES",
              activeCategoryCount: derived.activeCategoryCount,
            },
          });
          return adminSuccess({
            idealBudget: serializeIdealBudget(created),
            derivation: {
              source: "TREASURY_CATEGORIES",
              activeCategoryCount: derived.activeCategoryCount,
            },
          });
        },
      });
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
    const command = requireString(body.command, "command");
    if (command !== "activate" && command !== "refresh_snapshot") {
      return adminClientError(400, "UNKNOWN_COMMAND", "Unknown runway-plan command");
    }
    rejectRunwaySnapshotInjection(body);
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.publish",
      fn: async ({ userId, services }) => {
        if (command === "refresh_snapshot") {
          const snapshot = await services.breath.refreshRunwaySnapshot(
            requireOrgContext(organizationId),
            actor(userId),
            requireString(body.reason, "reason"),
          );
          return adminSuccess({ snapshot: serializeRunwaySnapshot(snapshot) });
        }
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

function isMultipartRequest(request: Request): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.toLowerCase().includes("multipart/form-data");
}

function formFieldsObject(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

const MEDIA_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const EVIDENCE_SOURCE_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;

function safeEvidenceMediaType(raw: string | undefined): string {
  if (raw && MEDIA_TYPE_RE.test(raw) && raw.length <= 127) return raw.toLowerCase();
  return "application/octet-stream";
}

function parseEvidenceSource(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return TREASURY_EVIDENCE_DEFAULT_SOURCE;
  const value = requireString(raw, "source");
  if (!EVIDENCE_SOURCE_RE.test(value)) {
    throw new TreasuryValidationError("INVALID_BODY", "source is not a permitted identifier");
  }
  return value;
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
  if (isMultipartRequest(request)) {
    return handleTreasuryEvidenceUpload(request, deps);
  }
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

export async function handleTreasuryEvidenceUpload(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  try {
    const form = await request.formData();
    const fields = formFieldsObject(form);
    rejectWatcherEnablement(fields);
    rejectCustodyMaterial(fields);
    rejectEvidenceClientStorageAuthority(fields);
    const organizationId = parseOrganizationIdFromUnknown(fields.organization_id);
    if (typeof organizationId !== "string") return organizationId;
    const visibilityRaw = fields.visibility;
    const visibility =
      visibilityRaw === undefined || visibilityRaw === null || visibilityRaw === ""
        ? "ADMIN_ONLY"
        : parseEvidenceVisibility(visibilityRaw);
    const permission: TreasuryAdminPermission =
      visibility === "PUBLIC" ? "admin.treasury.publish" : "admin.treasury.mutate";
    const file = form.get("file");
    if (typeof file === "string" || file === null) {
      throw new TreasuryValidationError("INVALID_BODY", "file is required");
    }
    if (typeof file.size === "number" && file.size > TREASURY_EVIDENCE_MAX_UPLOAD_BYTES) {
      throw new TreasuryValidationError(
        "EVIDENCE_TOO_LARGE",
        "Evidence upload exceeds the WP-5 safety size limit",
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > TREASURY_EVIDENCE_MAX_UPLOAD_BYTES) {
      throw new TreasuryValidationError(
        "EVIDENCE_TOO_LARGE",
        "Evidence upload exceeds the WP-5 safety size limit",
      );
    }
    const expectedSha256 =
      typeof fields.expected_sha256 === "string"
        ? fields.expected_sha256
        : typeof fields.sha256 === "string"
          ? fields.sha256
          : undefined;
    const observedAt =
      fields.observed_at === undefined || fields.observed_at === null || fields.observed_at === ""
        ? new Date()
        : requireIsoDate(fields.observed_at, "observed_at");
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission,
      fn: async ({ userId, services }) => {
        const context = requireOrgContext(organizationId);
        const admin = actor(userId);
        const reason = requireString(fields.reason, "reason");
        const record = await uploadTreasuryEvidenceObject({
          storage: services.evidenceStorage,
          register: async (row) => {
            await services.catalog.registerEvidenceObject(admin, row, reason);
          },
          lookup: (id) => services.catalog.getEvidence(context, id),
          payload: {
            organizationId,
            bytes,
            mediaType: safeEvidenceMediaType("type" in file ? file.type : undefined),
            kind: parseEvidenceKind(fields.kind),
            visibility,
            source: parseEvidenceSource(fields.source),
            observedAt,
            uploadedByUserId: userId,
            expectedSha256Hex: expectedSha256,
          },
        });
        return adminSuccess({ evidence: serializeEvidenceObject(record) });
      },
    });
  } catch (err) {
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryEvidenceContentGet(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
  evidenceObjectId: string,
): Promise<AdminRouteHandlerResult> {
  const organizationId = orgFromQuery(request);
  if (typeof organizationId !== "string") return organizationId;
  return withTreasuryAdmin({
    deps,
    organizationId,
    permission: "admin.treasury.read",
    fn: async ({ services }) => {
      const row = await services.catalog.getEvidence(
        requireOrgContext(organizationId),
        evidenceObjectId,
      );
      if (!row) return adminClientError(404, "TREASURY_NOT_FOUND", "evidence not found");
      if (!services.evidenceStorage) {
        throw new TreasuryValidationError(
          "EVIDENCE_STORAGE_NOT_CONFIGURED",
          "Evidence object storage is not configured",
        );
      }
      const stored = await services.evidenceStorage.get(row.objectKey);
      if (!stored) {
        throw new TreasuryValidationError(
          "EVIDENCE_CONTENT_UNAVAILABLE",
          "Evidence object content is unavailable",
        );
      }
      return adminSuccessBinary(stored.body, {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename="treasury-evidence-${row.id}.bin"`,
        "Content-Type": row.mediaType,
      });
    },
  });
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
      const preview = await services.breath.getAdminPreview(requireOrgContext(organizationId));
      return adminSuccess({ preview });
    },
  });
}

export type TreasuryLedgerCatalogKind = "counterparties" | "accounts" | "categories" | "projects";

function ledgerCatalogQuery(url: URL): TreasuryLedgerCatalogQuery {
  const active = url.searchParams.get("active");
  if (active !== null && active !== "true" && active !== "false") {
    throw new TreasuryValidationError("INVALID_BODY", "active must be true or false");
  }
  return {
    q: url.searchParams.get("q") ?? undefined,
    active: active === null ? undefined : active === "true",
    limit: parseBoundedLimit(url.searchParams.get("limit"), 50, 100),
    afterName: url.searchParams.get("after_name") ?? url.searchParams.get("afterName") ?? undefined,
    afterId: url.searchParams.get("after_id") ?? url.searchParams.get("afterId") ?? undefined,
  };
}

export async function handleTreasuryLedgerCatalogGet(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
  kind: TreasuryLedgerCatalogKind,
): Promise<AdminRouteHandlerResult> {
  try {
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
          switch (kind) {
            case "counterparties":
              return adminSuccess({
                counterparty: serializeCounterpartyDetail(
                  await services.ledgerCatalog.getCounterparty(context, id),
                ),
              });
            case "accounts":
              return adminSuccess({
                account: serializeAccountDetail(
                  await services.ledgerCatalog.getAccount(context, id),
                ),
              });
            case "categories":
              return adminSuccess({
                category: serializeCategory(await services.ledgerCatalog.getCategory(context, id)),
              });
            case "projects":
              return adminSuccess({
                project: serializeProject(await services.ledgerCatalog.getProject(context, id)),
              });
          }
        }
        const query = ledgerCatalogQuery(url);
        switch (kind) {
          case "counterparties": {
            const page = await services.ledgerCatalog.listCounterparties(context, query);
            return adminSuccess({
              counterparties: page.items.map(serializeCounterpartySummary),
              next: page.next,
            });
          }
          case "accounts": {
            const page = await services.ledgerCatalog.listAccounts(context, query);
            return adminSuccess({
              accounts: page.items.map(serializeAccountSummary),
              next: page.next,
            });
          }
          case "categories": {
            const page = await services.ledgerCatalog.listCategories(context, query);
            return adminSuccess({ categories: page.items.map(serializeCategory), next: page.next });
          }
          case "projects": {
            const page = await services.ledgerCatalog.listProjects(context, query);
            return adminSuccess({ projects: page.items.map(serializeProject), next: page.next });
          }
        }
      },
    });
  } catch (err) {
    return mapTreasuryHttpError(err);
  }
}

export async function handleTreasuryLedgerCatalogPost(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
  kind: TreasuryLedgerCatalogKind,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    rejectCustodyMaterial(body);
    const organizationId = parseOrganizationIdFromUnknown(
      body.organization_id ?? body.organizationId,
    );
    if (typeof organizationId !== "string") return organizationId;
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const context = requireOrgContext(organizationId);
        const admin = actor(userId);
        const reason = requireString(body.reason, "reason");
        switch (kind) {
          case "counterparties":
            return adminSuccess({
              counterparty: serializeCounterpartyDetail(
                await services.ledgerCatalog.createCounterparty(context, admin, {
                  displayName: requireString(body.display_name ?? body.displayName, "display_name"),
                  websiteUrl: optionalString(body.website_url ?? body.websiteUrl, "website_url"),
                  email: optionalString(body.email, "email"),
                  phone: optionalString(body.phone, "phone"),
                  paymentInstructions: optionalString(
                    body.payment_instructions ?? body.paymentInstructions,
                    "payment_instructions",
                  ),
                  waiaUsername: optionalString(
                    body.waia_username ?? body.waiaUsername,
                    "waia_username",
                  ),
                  reason,
                }),
              ),
            });
          case "accounts":
            return adminSuccess({
              account: serializeAccountDetail(
                await services.ledgerCatalog.createAccount(context, admin, {
                  displayName: requireString(body.display_name ?? body.displayName, "display_name"),
                  kind: parseEnum(body.kind, treasuryAccountKindEnum, "kind"),
                  currency: requireString(body.currency, "currency"),
                  network: optionalString(body.network, "network"),
                  address: optionalString(body.address, "address"),
                  maskedRequisites: optionalString(
                    body.masked_requisites ?? body.maskedRequisites,
                    "masked_requisites",
                  ),
                  watchedAddressId: optionalString(
                    body.watched_address_id ?? body.watchedAddressId,
                    "watched_address_id",
                  ),
                  reason,
                }),
              ),
            });
          case "categories":
            return adminSuccess({
              category: serializeCategory(
                await services.ledgerCatalog.createCategory(context, admin, {
                  code: requireString(body.code, "code"),
                  name: requireString(body.name, "name"),
                  description: optionalString(body.description, "description"),
                  monthlyBudgetMicros: parseNonnegativeDecimalBigint(
                    body.monthly_budget_micros ?? body.monthlyBudgetMicros,
                    "monthly_budget_micros",
                  ),
                  currency: requireString(body.currency, "currency"),
                  reason,
                }),
              ),
            });
          case "projects":
            return adminSuccess({
              project: serializeProject(
                await services.ledgerCatalog.createProject(context, admin, {
                  name: requireString(body.name, "name"),
                  description: optionalString(body.description, "description"),
                  startsOn: optionalString(body.starts_on ?? body.startsOn, "starts_on"),
                  endsOn: optionalString(body.ends_on ?? body.endsOn, "ends_on"),
                  reason,
                }),
              ),
            });
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

export async function handleTreasuryLedgerCatalogPatch(
  request: Request,
  deps: TreasuryAdminHandlerDeps,
  kind: TreasuryLedgerCatalogKind,
): Promise<AdminRouteHandlerResult> {
  try {
    const body = await readJsonObject(request);
    rejectCustodyMaterial(body);
    const organizationId = parseOrganizationIdFromUnknown(
      body.organization_id ?? body.organizationId,
    );
    if (typeof organizationId !== "string") return organizationId;
    return withTreasuryAdmin({
      deps,
      organizationId,
      permission: "admin.treasury.mutate",
      fn: async ({ userId, services }) => {
        const context = requireOrgContext(organizationId);
        const admin = actor(userId);
        const id = requireString(body.id, "id");
        const reason = requireString(body.reason, "reason");
        const active =
          body.is_active === undefined && body.isActive === undefined
            ? undefined
            : requireBoolean(body.is_active ?? body.isActive, "is_active");
        switch (kind) {
          case "counterparties":
            return adminSuccess({
              counterparty: serializeCounterpartyDetail(
                await services.ledgerCatalog.updateCounterparty(context, admin, id, {
                  displayName:
                    body.display_name === undefined && body.displayName === undefined
                      ? undefined
                      : requireString(body.display_name ?? body.displayName, "display_name"),
                  websiteUrl:
                    body.website_url === undefined && body.websiteUrl === undefined
                      ? undefined
                      : optionalString(body.website_url ?? body.websiteUrl, "website_url"),
                  email: body.email === undefined ? undefined : optionalString(body.email, "email"),
                  phone: body.phone === undefined ? undefined : optionalString(body.phone, "phone"),
                  paymentInstructions:
                    body.payment_instructions === undefined &&
                    body.paymentInstructions === undefined
                      ? undefined
                      : optionalString(
                          body.payment_instructions ?? body.paymentInstructions,
                          "payment_instructions",
                        ),
                  waiaUsername:
                    body.waia_username === undefined && body.waiaUsername === undefined
                      ? undefined
                      : optionalString(body.waia_username ?? body.waiaUsername, "waia_username"),
                  isActive: active,
                  reason,
                }),
              ),
            });
          case "accounts":
            return adminSuccess({
              account: serializeAccountDetail(
                await services.ledgerCatalog.updateAccount(context, admin, id, {
                  displayName:
                    body.display_name === undefined && body.displayName === undefined
                      ? undefined
                      : requireString(body.display_name ?? body.displayName, "display_name"),
                  kind:
                    body.kind === undefined
                      ? undefined
                      : parseEnum(body.kind, treasuryAccountKindEnum, "kind"),
                  currency:
                    body.currency === undefined
                      ? undefined
                      : requireString(body.currency, "currency"),
                  network:
                    body.network === undefined
                      ? undefined
                      : optionalString(body.network, "network"),
                  address:
                    body.address === undefined
                      ? undefined
                      : optionalString(body.address, "address"),
                  maskedRequisites:
                    body.masked_requisites === undefined && body.maskedRequisites === undefined
                      ? undefined
                      : optionalString(
                          body.masked_requisites ?? body.maskedRequisites,
                          "masked_requisites",
                        ),
                  watchedAddressId:
                    body.watched_address_id === undefined && body.watchedAddressId === undefined
                      ? undefined
                      : optionalString(
                          body.watched_address_id ?? body.watchedAddressId,
                          "watched_address_id",
                        ),
                  isActive: active,
                  reason,
                }),
              ),
            });
          case "categories":
            return adminSuccess({
              category: serializeCategory(
                await services.ledgerCatalog.updateCategory(context, admin, id, {
                  code: body.code === undefined ? undefined : requireString(body.code, "code"),
                  name: body.name === undefined ? undefined : requireString(body.name, "name"),
                  description:
                    body.description === undefined
                      ? undefined
                      : optionalString(body.description, "description"),
                  monthlyBudgetMicros:
                    body.monthly_budget_micros === undefined &&
                    body.monthlyBudgetMicros === undefined
                      ? undefined
                      : parseNonnegativeDecimalBigint(
                          body.monthly_budget_micros ?? body.monthlyBudgetMicros,
                          "monthly_budget_micros",
                        ),
                  currency:
                    body.currency === undefined
                      ? undefined
                      : requireString(body.currency, "currency"),
                  isActive: active,
                  reason,
                }),
              ),
            });
          case "projects":
            return adminSuccess({
              project: serializeProject(
                await services.ledgerCatalog.updateProject(context, admin, id, {
                  name: body.name === undefined ? undefined : requireString(body.name, "name"),
                  description:
                    body.description === undefined
                      ? undefined
                      : optionalString(body.description, "description"),
                  startsOn:
                    body.starts_on === undefined && body.startsOn === undefined
                      ? undefined
                      : optionalString(body.starts_on ?? body.startsOn, "starts_on"),
                  endsOn:
                    body.ends_on === undefined && body.endsOn === undefined
                      ? undefined
                      : optionalString(body.ends_on ?? body.endsOn, "ends_on"),
                  isActive: active,
                  reason,
                }),
              ),
            });
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

export { treasuryBackendUnavailable };
