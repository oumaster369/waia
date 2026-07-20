import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { organizations } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import {
  adminClientError,
  adminSuccess,
  assertAdminPermission,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";

export async function handleAdminOrganizationsList(
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const userId = await deps.getUserId();
  if (!userId) {
    return adminClientError(401, "UNAUTHORIZED", "Sign in required.");
  }

  let runtime;
  try {
    runtime = await deps.getRuntimeDb();
    const contextOrgId = personalOrganizationIdFromUserId(userId);
    const check = await assertAdminPermission(runtime, userId, contextOrgId, "admin.org.read");
    if (!check.allowed) {
      return adminClientError(403, "FORBIDDEN", "Admin org read permission required.");
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
