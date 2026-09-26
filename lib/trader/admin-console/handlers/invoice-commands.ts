import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  adminClientError,
  adminSuccess,
  mapServiceError,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import { staleRevisionResult } from "@/lib/trader/admin-console/auth";
import {
  INVOICE_SELECT,
  invoiceReadRevision,
} from "@/lib/trader/admin-console/repositories/invoices.postgres";
import {
  organizationFilter,
  exchangeAccountFilter,
} from "@/lib/trader/admin-console/sql/read-scope";
import { createPostgresInvoiceIssuanceService } from "@/lib/trader/billing/invoice-issuance-service";
import { resolvePermissionPostgres } from "@/lib/waia-core/permissions/resolve";
import { lockInvoiceCommandAccountPostgres } from "@/lib/trader/billing/invoice-command-lock-postgres";
import { DraftInvoiceDigestMismatchError } from "@/lib/trader/billing/invoice.errors";

const attestations = z
  .object({
    depositsVerified: z.literal(true),
    withdrawalsVerified: z.literal(true),
    balanceSnapshotsVerified: z.literal(true),
    reconciliationVerified: z.literal(true),
    exchangeSyncVerified: z.literal(true),
    realizedFillFinalityVerified: z.literal(true),
  })
  .strict();
const base = { expectedRevision: z.string().min(1), organization_id: z.string().uuid() };
const schema = z.discriminatedUnion("command", [
  z.object({ ...base, command: z.literal("approve"), attestations }).strict(),
  z.object({ ...base, command: z.literal("issue"), confirmed: z.literal(true) }).strict(),
  z
    .object({
      ...base,
      command: z.literal("cancel-pending"),
      reason: z.string().trim().min(1).max(2000),
    })
    .strict(),
]);
export async function handleAdminConsoleInvoiceCommandPost(
  request: Request,
  deps: AdminRouteHandlerDeps,
  invoiceId: string,
): Promise<AdminRouteHandlerResult> {
  const query = parseAdminConsoleQuery(new URL(request.url));
  if (!query.ok) return query.result;
  if (!z.string().uuid().safeParse(invoiceId).success)
    return adminClientError(400, "BAD_REQUEST", "Invalid invoice id.");
  const opened = await openAdminConsole(request, deps, {
    mutate: true,
    requiredTables: HANDLER_TABLES.invoiceCommands,
  });
  if (!opened.ok) return opened.result;
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return adminClientError(
        400,
        "BAD_REQUEST",
        "Read revision and manual confirmations required.",
      );
    const body = parsed.data;
    return await opened.runtime.db.transaction(async (tx) => {
      const rows = await tx.execute(sql`SELECT ${INVOICE_SELECT} FROM trader_invoices i
        WHERE i.id = ${invoiceId}::uuid AND i.organization_id = ${body.organization_id}::uuid
          AND ${organizationFilter(query.query, "i")} AND ${exchangeAccountFilter(query.query, "i")} FOR UPDATE OF i`);
      const row = rows[0];
      if (!row) return adminClientError(404, "NOT_FOUND", "Invoice not found in scope.");
      const revision = invoiceReadRevision(row);
      if (revision !== body.expectedRevision) return staleRevisionResult({ revision, invoiceId });
      if (body.command !== "cancel-pending") {
        await lockInvoiceCommandAccountPostgres(tx, body.organization_id, String(row.exchange_account_id));
      }
      // Keep the existing issuance service and all its canonical-source, cooling-off, HWM and audit checks.
      // The console operator has fleet admin permissions; no tenant membership or module grant is manufactured.
      const service = createPostgresInvoiceIssuanceService(tx, {
        assertMembership: async (context) => {
          for (const permission of ["admin.audit.read", "admin.trader.operations.mutate"]) {
            const check = await resolvePermissionPostgres(tx, {
              userId: context.userId,
              organizationId: context.organizationId,
              permission,
            });
            if (!check.allowed) throw new Error("ADMIN_PERMISSION_REVOKED");
          }
        },
      });
      const context = { organizationId: body.organization_id, userId: opened.userId };
      try {
        if (body.command === "approve")
          await service.approveInvoiceIssuance(context, {
            invoiceId,
            attestations: body.attestations,
          });
        else if (body.command === "issue") await service.issueInvoice(context, { invoiceId });
        else await service.cancelPendingIssuance(context, { invoiceId, reason: body.reason });
      } catch (error) {
        // These business failures deliberately clear a stale approval inside the existing service.
        // Preserve that invalidation; unexpected persistence/audit errors roll the whole transaction back.
        const code =
          error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (
          error instanceof DraftInvoiceDigestMismatchError ||
          ["INVOICE_RECORD_DIGEST_MISMATCH", "ISSUANCE_HWM_INCONSISTENT"].includes(code)
        )
          return mapServiceError(error);
        throw error;
      }
      const next = await tx.execute(
        sql`SELECT ${INVOICE_SELECT} FROM trader_invoices i WHERE i.id = ${invoiceId}::uuid AND i.organization_id = ${body.organization_id}::uuid`,
      );
      return adminSuccess(
        { invoiceId, revision: invoiceReadRevision(next[0]), confirmation: "READ_BACK_REQUIRED" },
        "postgres",
      );
    }, { isolationLevel: "read committed" });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_PERMISSION_REVOKED")
      return adminClientError(403, "FORBIDDEN", "Admin permission required.");
    return mapServiceError(error);
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
