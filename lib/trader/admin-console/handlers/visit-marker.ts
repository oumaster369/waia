import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { traderAdminVisitMarker } from "@/db/schema.postgres";
import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { staleRevisionResult } from "@/lib/trader/admin-console/auth";
import { adminRevision } from "@/lib/trader/admin-console/revision";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";

const writeSchema = z
  .object({ expectedRevision: z.string().min(1), adminUserId: z.string().uuid().optional() })
  .strict();
function dto(row: { lastSeenAt: Date; previousSeenAt: Date | null } | undefined) {
  const data = {
    lastSeenAt: row?.lastSeenAt.toISOString() ?? null,
    previousSeenAt: row?.previousSeenAt?.toISOString() ?? null,
  };
  return { ...data, revision: adminRevision(data) };
}

export async function handleAdminConsoleVisitMarkerGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.visitMarker,
  });
  if (!opened.ok) return opened.result;
  try {
    const owner = new URL(request.url).searchParams.get("admin_user_id");
    if (owner && owner !== opened.userId)
      return adminClientError(404, "NOT_FOUND", "Visit marker was not found.");
    const rows = await opened.runtime.db
      .select()
      .from(traderAdminVisitMarker)
      .where(eq(traderAdminVisitMarker.adminUserId, opened.userId))
      .limit(1);
    return adminSuccess(dto(rows[0]), "postgres");
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}

export async function handleAdminConsoleVisitMarkerPost(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const opened = await openAdminConsole(request, deps, {
    mutate: true,
    requiredTables: HANDLER_TABLES.visitMarker,
  });
  if (!opened.ok) return opened.result;
  try {
    const parsed = writeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return adminClientError(400, "BAD_REQUEST", "Visit marker requires expectedRevision.");
    if (parsed.data.adminUserId && parsed.data.adminUserId !== opened.userId)
      return adminClientError(404, "NOT_FOUND", "Visit marker was not found.");
    return await opened.runtime.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`admin-visit-marker:${opened.userId}`}, 0))`,
      );
      const rows = await tx
        .select()
        .from(traderAdminVisitMarker)
        .where(eq(traderAdminVisitMarker.adminUserId, opened.userId))
        .limit(1);
      const current = rows[0];
      const view = dto(current);
      if (parsed.data.expectedRevision !== view.revision) return staleRevisionResult(view);
      const now = new Date(Math.max(Date.now(), (current?.lastSeenAt.getTime() ?? 0) + 1));
      const values = { lastSeenAt: now, previousSeenAt: current?.lastSeenAt ?? null };
      if (!current)
        await tx
          .insert(traderAdminVisitMarker)
          .values({ adminUserId: opened.userId, organizationId: opened.contextOrgId, ...values });
      else
        await tx
          .update(traderAdminVisitMarker)
          .set(values)
          .where(eq(traderAdminVisitMarker.adminUserId, opened.userId));
      return adminSuccess(dto(values), "postgres");
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
