import { eq } from "drizzle-orm";

import { traderAdminVisitMarker } from "@/db/schema.postgres";
import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
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
    const rows = await opened.runtime.db
      .select()
      .from(traderAdminVisitMarker)
      .where(eq(traderAdminVisitMarker.adminUserId, opened.userId))
      .limit(1);
    const row = rows[0];
    return adminSuccess(
      {
        lastSeenAt: row ? iso(row.lastSeenAt) : null,
        previousSeenAt: row ? iso(row.previousSeenAt) : null,
      },
      "postgres",
    );
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
    const now = new Date();
    const rows = await opened.runtime.db
      .select()
      .from(traderAdminVisitMarker)
      .where(eq(traderAdminVisitMarker.adminUserId, opened.userId))
      .limit(1);
    const current = rows[0];
    if (!current) {
      await opened.runtime.db.insert(traderAdminVisitMarker).values({
        adminUserId: opened.userId,
        organizationId: opened.contextOrgId,
        lastSeenAt: now,
        previousSeenAt: null,
      });
    } else {
      await opened.runtime.db
        .update(traderAdminVisitMarker)
        .set({ previousSeenAt: current.lastSeenAt, lastSeenAt: now })
        .where(eq(traderAdminVisitMarker.adminUserId, opened.userId));
    }
    return adminSuccess(
      {
        lastSeenAt: now.toISOString(),
        previousSeenAt: current ? iso(current.lastSeenAt) : null,
      },
      "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
