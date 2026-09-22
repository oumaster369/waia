import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { and, desc, eq } from "drizzle-orm";

import { exchangeCredentials, organizations } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import {
  adminClientError,
  adminSuccess,
  assertAdminPermission,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import {
  ADMIN_LISTED_CREDENTIAL_STATUS,
  ADMIN_LISTED_ORGANIZATION_KIND,
  ADMIN_LISTED_VENUE,
  isAdminConnectedAccountScope,
} from "@/lib/trader/credentials/admin-connected-account-scope";
import type { ConnectedHtxAccountDto } from "@/lib/trader/credentials/connected-accounts.types";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

const MAX_CONNECTED_ACCOUNTS = 200;

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date(0).toISOString();
}

function toDto(row: {
  organizationId: string;
  organizationKind: string;
  accountName: string | null;
  credentialId: string;
  exchangeAccountId: string;
  venue: string;
  status: string;
  updatedAt: Date | string;
}): ConnectedHtxAccountDto | null {
  if (
    !isAdminConnectedAccountScope({
      organizationKind: row.organizationKind,
      venue: row.venue,
      credentialStatus: row.status,
    })
  )
    return null;
  return {
    organizationId: row.organizationId,
    accountName: row.accountName?.trim() || "Account",
    credentialId: row.credentialId,
    exchangeAccountId: row.exchangeAccountId,
    venue: "htx",
    status: "active",
    updatedAt: toIso(row.updatedAt),
  };
}

/** Lists personal-org cabinets with an active HTX key. Does not decrypt secrets or invent PnL. */
export async function handleAdminConnectedAccountsGet(
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
    const check = await assertAdminPermission(runtime, userId, contextOrgId, "admin.audit.read");
    if (!check.allowed) {
      return adminClientError(403, "FORBIDDEN", "Admin audit read permission required.");
    }

    if (runtime.kind === "sqlite") {
      const rows = runtime.db
        .select({
          organizationId: organizations.id,
          organizationKind: organizations.kind,
          accountName: organizations.name,
          credentialId: exchangeCredentials.id,
          exchangeAccountId: exchangeCredentials.exchangeAccountId,
          venue: exchangeCredentials.venue,
          status: exchangeCredentials.status,
          updatedAt: exchangeCredentials.updatedAt,
        })
        .from(exchangeCredentials)
        .innerJoin(organizations, eq(organizations.id, exchangeCredentials.organizationId))
        .where(
          and(
            eq(exchangeCredentials.status, ADMIN_LISTED_CREDENTIAL_STATUS),
            eq(exchangeCredentials.venue, ADMIN_LISTED_VENUE),
            eq(organizations.kind, ADMIN_LISTED_ORGANIZATION_KIND),
          ),
        )
        .orderBy(desc(exchangeCredentials.updatedAt))
        .limit(MAX_CONNECTED_ACCOUNTS)
        .all();
      return adminSuccess(
        { accounts: rows.map(toDto).filter((row): row is ConnectedHtxAccountDto => row !== null) },
        "sqlite",
      );
    }

    const rows = await runtime.db
      .select({
        organizationId: pgSchema.organizations.id,
        organizationKind: pgSchema.organizations.kind,
        accountName: pgSchema.organizations.name,
        credentialId: pgSchema.exchangeCredentials.id,
        exchangeAccountId: pgSchema.exchangeCredentials.exchangeAccountId,
        venue: pgSchema.exchangeCredentials.venue,
        status: pgSchema.exchangeCredentials.status,
        updatedAt: pgSchema.exchangeCredentials.updatedAt,
      })
      .from(pgSchema.exchangeCredentials)
      .innerJoin(
        pgSchema.organizations,
        eq(pgSchema.organizations.id, pgSchema.exchangeCredentials.organizationId),
      )
      .where(
        and(
          eq(pgSchema.exchangeCredentials.status, ADMIN_LISTED_CREDENTIAL_STATUS),
          eq(pgSchema.exchangeCredentials.venue, ADMIN_LISTED_VENUE),
          eq(pgSchema.organizations.kind, ADMIN_LISTED_ORGANIZATION_KIND),
        ),
      )
      .orderBy(desc(pgSchema.exchangeCredentials.updatedAt))
      .limit(MAX_CONNECTED_ACCOUNTS);
    return adminSuccess(
      { accounts: rows.map(toDto).filter((row): row is ConnectedHtxAccountDto => row !== null) },
      "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}
