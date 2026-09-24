import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { traderAdminSavedView } from "@/db/schema.postgres";
import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { staleRevisionResult } from "@/lib/trader/admin-console/auth";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { adminRevision } from "@/lib/trader/admin-console/revision";

const writeSchema = z.object({
  id: z.string().uuid().optional(),
  section: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  state: z.unknown(),
  expectedRevision: z.string().min(1),
});

const deleteSchema = z.object({
  id: z.string().uuid(),
  expectedRevision: z.string().min(1),
});

type SavedRow = {
  id: string;
  section: string;
  name: string;
  stateJson: unknown;
  updatedAt: Date;
};

function viewRevision(rows: readonly SavedRow[]): string {
  return adminRevision(
    [...rows]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => ({
        id: row.id,
        section: row.section,
        name: row.name,
        state: row.stateJson,
        updatedAt: row.updatedAt.toISOString(),
      })),
  );
}

function toDto(row: SavedRow) {
  return {
    id: row.id,
    section: row.section,
    name: row.name,
    state: row.stateJson,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function handleAdminConsoleSavedViewsGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.savedViews,
  });
  if (!opened.ok) return opened.result;
  try {
    const rows = await opened.runtime.db
      .select()
      .from(traderAdminSavedView)
      .where(eq(traderAdminSavedView.adminUserId, opened.userId));
    return adminSuccess({ revision: viewRevision(rows), views: rows.map(toDto) }, "postgres");
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}

export async function handleAdminConsoleSavedViewsPost(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const opened = await openAdminConsole(request, deps, {
    mutate: true,
    requiredTables: HANDLER_TABLES.savedViews,
  });
  if (!opened.ok) return opened.result;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    await deps.disposeRuntimeDb(opened.runtime);
    return adminClientError(400, "BAD_REQUEST", "JSON body required.");
  }
  const parsed = writeSchema.safeParse(body);
  if (!parsed.success) {
    await deps.disposeRuntimeDb(opened.runtime);
    return adminClientError(400, "BAD_REQUEST", "Saved view body is invalid.");
  }
  try {
    return await opened.runtime.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`admin-saved-views:${opened.userId}`}, 0))`,
      );
      const rows = await tx
        .select()
        .from(traderAdminSavedView)
        .where(eq(traderAdminSavedView.adminUserId, opened.userId));
      if (parsed.data.id && !rows.some((row) => row.id === parsed.data.id))
        return adminClientError(404, "NOT_FOUND", "Saved view was not found.");
      const revision = viewRevision(rows);
      if (parsed.data.expectedRevision !== revision) {
        return staleRevisionResult({ revision, views: rows.map(toDto) });
      }
      const now = new Date();
      if (parsed.data.id) {
        const owned = rows.find((row) => row.id === parsed.data.id);
        if (!owned) return adminClientError(404, "NOT_FOUND", "Saved view was not found.");
        await tx
          .update(traderAdminSavedView)
          .set({
            section: parsed.data.section,
            name: parsed.data.name,
            stateJson: parsed.data.state,
            updatedAt: now,
          })
          .where(
            and(
              eq(traderAdminSavedView.id, parsed.data.id),
              eq(traderAdminSavedView.adminUserId, opened.userId),
            ),
          );
      } else {
        await tx.insert(traderAdminSavedView).values({
          id: crypto.randomUUID(),
          organizationId: opened.contextOrgId,
          adminUserId: opened.userId,
          section: parsed.data.section,
          name: parsed.data.name,
          stateJson: parsed.data.state,
          createdAt: now,
          updatedAt: now,
        });
      }
      const next = await tx
        .select()
        .from(traderAdminSavedView)
        .where(eq(traderAdminSavedView.adminUserId, opened.userId));
      return adminSuccess({ revision: viewRevision(next), views: next.map(toDto) }, "postgres");
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}

export async function handleAdminConsoleSavedViewsDelete(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const opened = await openAdminConsole(request, deps, {
    mutate: true,
    requiredTables: HANDLER_TABLES.savedViews,
  });
  if (!opened.ok) return opened.result;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    await deps.disposeRuntimeDb(opened.runtime);
    return adminClientError(400, "BAD_REQUEST", "JSON body required.");
  }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    await deps.disposeRuntimeDb(opened.runtime);
    return adminClientError(400, "BAD_REQUEST", "Saved view body is invalid.");
  }
  try {
    return await opened.runtime.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`admin-saved-views:${opened.userId}`}, 0))`,
      );
      const rows = await tx
        .select()
        .from(traderAdminSavedView)
        .where(eq(traderAdminSavedView.adminUserId, opened.userId));
      if (parsed.data.id && !rows.some((row) => row.id === parsed.data.id))
        return adminClientError(404, "NOT_FOUND", "Saved view was not found.");
      const revision = viewRevision(rows);
      if (parsed.data.expectedRevision !== revision) {
        return staleRevisionResult({ revision, views: rows.map(toDto) });
      }
      const owned = rows.find((row) => row.id === parsed.data.id);
      if (!owned) return adminClientError(404, "NOT_FOUND", "Saved view was not found.");
      await tx
        .delete(traderAdminSavedView)
        .where(
          and(
            eq(traderAdminSavedView.id, parsed.data.id),
            eq(traderAdminSavedView.adminUserId, opened.userId),
          ),
        );
      const next = rows.filter((row) => row.id !== parsed.data.id);
      return adminSuccess({ revision: viewRevision(next), views: next.map(toDto) }, "postgres");
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
