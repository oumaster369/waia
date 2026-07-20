import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import {
  listAuditLogsForAdminPostgres,
  listAuditLogsForEntityPostgres,
  listAuditLogsForEntitySqlite,
  listAuditLogsForAdminSqlite,
} from "@/lib/waia-core/audit/read";
import {
  adminSuccess,
  authorizeAdminRoute,
  parseOrganizationId,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

function serializeAuditRow(row: {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  organizationId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function handleAdminAuditList(
  request: Request,
  deps: AdminRouteHandlerDeps,
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

    const entityType = url.searchParams.get("entity_type")?.trim();
    const entityId = url.searchParams.get("entity_id")?.trim();
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 50;
    const scoped = requireOrgContext(orgParsed);

    if (entityType && entityId) {
      const rows =
        runtime.kind === "sqlite"
          ? listAuditLogsForEntitySqlite(runtime.db, {
              organizationId: scoped.organizationId,
              entityType,
              entityId,
              limit,
            })
          : await listAuditLogsForEntityPostgres(runtime.db, {
              organizationId: scoped.organizationId,
              entityType,
              entityId,
              limit,
            });
      return adminSuccess({ auditLogs: rows.map(serializeAuditRow) }, runtime.kind);
    }

    const rows =
      runtime.kind === "sqlite"
        ? listAuditLogsForAdminSqlite(runtime.db, {
            adminUserId: auth.userId,
            organizationId: scoped.organizationId,
            limit,
          })
        : await listAuditLogsForAdminPostgres(runtime.db, {
            adminUserId: auth.userId,
            organizationId: scoped.organizationId,
            limit,
          });

    return adminSuccess({ auditLogs: rows.map(serializeAuditRow) }, runtime.kind);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}
