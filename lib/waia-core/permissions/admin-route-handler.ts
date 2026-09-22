import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { organizationEntitlements, organizations } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import { and, eq } from "drizzle-orm";
import {
  filterOrganizationsByTraderEntitlement,
  TRADER_ADMIN_ENTITLEMENT_KEY,
} from "@/lib/waia-core/permissions/trader-org-filter";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import {
  adminClientError,
  adminSuccess,
  assertAdminPermission,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/waia-core/permissions/admin-http";

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
      const entitled = runtime.db
        .select({ organizationId: organizationEntitlements.organizationId })
        .from(organizationEntitlements)
        .where(
          and(
            eq(organizationEntitlements.entitlementKey, TRADER_ADMIN_ENTITLEMENT_KEY),
            eq(organizationEntitlements.enabled, true),
          ),
        )
        .all();
      return adminSuccess(
        {
          organizations: filterOrganizationsByTraderEntitlement(
            rows,
            new Set(entitled.map((row) => row.organizationId)),
          ),
        },
        "sqlite",
      );
    }

    const rows = await runtime.db
      .select({
        id: pgSchema.organizations.id,
        name: pgSchema.organizations.name,
        kind: pgSchema.organizations.kind,
      })
      .from(pgSchema.organizations);
    const entitled = await runtime.db
      .select({ organizationId: pgSchema.organizationEntitlements.organizationId })
      .from(pgSchema.organizationEntitlements)
      .where(
        and(
          eq(pgSchema.organizationEntitlements.entitlementKey, TRADER_ADMIN_ENTITLEMENT_KEY),
          eq(pgSchema.organizationEntitlements.enabled, true),
        ),
      );
    return adminSuccess(
      {
        organizations: filterOrganizationsByTraderEntitlement(
          rows,
          new Set(entitled.map((row) => row.organizationId)),
        ),
      },
      "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}
