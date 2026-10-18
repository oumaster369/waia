import "server-only";
import { and, eq } from "drizzle-orm";
import { getFreshOptionalAdminSessionUserId } from "@/lib/auth/session-user";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb, type WaiaRuntimeDb } from "@/db/waia-runtime-db";
import * as pgSchema from "@/db/schema.postgres";
import { assertOrgMembershipPostgres, OrgScopeError } from "@/lib/waia-core/scope/org-context";
import { hasModuleEntitlementPostgres } from "@/lib/waia-core/entitlements/authoritative";
import { assertAdminPermission } from "@/lib/waia-core/permissions/admin-http";
import {
  ADMIN_LISTED_CREDENTIAL_STATUS,
  ADMIN_LISTED_ORGANIZATION_KIND,
  ADMIN_LISTED_VENUE,
  isAdminConnectedAccountScope,
} from "@/lib/trader/credentials/admin-connected-account-scope";
import { createProjectionClient, type ProjectionClient } from "./projection-client";
import { createObservationFailureTrace } from "./failure-stage";
import { handleAccountObservationGet, type ObservationReadDependencies } from "./read-handler";

/** Dormant unless the fixed snapshot-only HTTPS transport is explicitly configured.
 * No exchange calls, provisioning, collection startup, secret decryption or DB fallback.
 * Existing WAIA access storage is used only for membership/entitlement/permission reads.
 */
export function createAccountObservationRouteDependencies() {
  // Capture before the first session/authorization await, never once per operation.
  const deadlineMs = Date.now() + 5000;
  const failureTrace = createObservationFailureTrace();
  let access: Promise<WaiaRuntimeDb> | undefined;
  let projection: ProjectionClient | undefined;
  let disposed = false;
  const assertOpen = (signal: AbortSignal) => {
    if (disposed || signal.aborted || Date.now() >= deadlineMs) throw new Error("ACCOUNT_OBSERVATION_UNAVAILABLE");
  };
  const runtime = async (signal: AbortSignal) => {
    assertOpen(signal);
    if (!access) {
      failureTrace.enter("RUNTIME_INIT");
      access = getWaiaRuntimeDb();
    }
    let db: WaiaRuntimeDb;
    try { db = await access; }
    catch (error) { failureTrace.capture("THREW"); throw error; }
    assertOpen(signal);
    if (db.kind !== "postgres") throw new Error("ACCOUNT_OBSERVATION_POSTGRES_REQUIRED");
    return db;
  };
  const reader = (signal: AbortSignal) => {
    assertOpen(signal);
    if (!projection) {
      failureTrace.enter("PROJECTION_CONFIG");
      const keyHex = process.env.WAIA_ACCOUNT_OBSERVATION_PROJECTION_HMAC_KEY_HEX;
      const workerReleaseSha = process.env.WAIA_RELEASE_SHA ?? "";
      // The Worker release describes this web artifact. The projection tuple's
      // release must remain pinned to the independently deployed reader until
      // that reader's expected tuple is deliberately rotated. An unset pin
      // retains the historical coupling for deployments that haven't adopted
      // the separate setting; an explicitly empty or malformed pin is refused.
      const configuredProjectionReleaseSha =
        process.env.WAIA_ACCOUNT_OBSERVATION_PROJECTION_RELEASE_SHA;
      const projectionReleaseSha =
        configuredProjectionReleaseSha === undefined
          ? workerReleaseSha
          : configuredProjectionReleaseSha;
      if (process.env.WAIA_ACCOUNT_OBSERVATION_PROJECTION_ENABLED !== "1" ||
          !keyHex || !/^[0-9a-f]{64}$/.test(keyHex) ||
          !/^[0-9a-f]{40}$/.test(workerReleaseSha) ||
          !/^[0-9a-f]{40}$/.test(projectionReleaseSha)) {
        throw new Error("ACCOUNT_OBSERVATION_NOT_CONFIGURED");
      }
      const keyBytes = Uint8Array.from(keyHex.match(/../g)!, x => Number.parseInt(x, 16));
      try {
        projection = createProjectionClient({
          fetch: globalThis.fetch.bind(globalThis), clock: Date.now, deadlineMs, failureTrace,
          tuple: { audience: "https://observation-reader.waia.life",
            releaseSha: projectionReleaseSha,
            epochId: process.env.WAIA_ACCOUNT_OBSERVATION_PROJECTION_EPOCH ?? "",
            keyId: process.env.WAIA_ACCOUNT_OBSERVATION_PROJECTION_KEY_ID ?? "" },
          keyBytes,
          accessClientId: process.env.WAIA_ACCOUNT_OBSERVATION_PROJECTION_ACCESS_CLIENT_ID ?? "",
          accessClientSecret: process.env.WAIA_ACCOUNT_OBSERVATION_PROJECTION_ACCESS_CLIENT_SECRET ?? "",
        });
      } finally { keyBytes.fill(0); }
    }
    return projection;
  };
  const deps: ObservationReadDependencies = {
    failureTrace,
    async getUserId(signal) { assertOpen(signal); return getFreshOptionalAdminSessionUserId(); },
    async hasTraderAccess(_userId, organizationId, signal) {
      const db = await runtime(signal);
      failureTrace.enter("ENTITLEMENT");
      return hasModuleEntitlementPostgres(db.db, { organizationId, entitlementKey: "trader" });
    },
    async hasOrgMembership(userId, organizationId, signal) {
      const db = await runtime(signal);
      failureTrace.enter("MEMBERSHIP");
      try { await assertOrgMembershipPostgres(db.db, { userId, organizationId }); return true; }
      catch (error) {
        // Only an authoritative missing-membership result is a denial. A failed
        // read must stay unavailable, so the browser can recover without treating
        // a transient database error as permanent credential revocation.
        if (error instanceof OrgScopeError && error.message === "ORG_MEMBERSHIP_REQUIRED") return false;
        throw error;
      }
    },
    async hasOperatorAccess(userId, organizationId, signal) {
      const db = await runtime(signal);
      failureTrace.enter("OPERATOR_PERMISSION");
      return (await assertAdminPermission(db, userId, organizationId, "admin.audit.read")).allowed;
    },
    async isAdminListedOrganization(organizationId, signal) {
      const db = await runtime(signal);
      failureTrace.enter("ADMIN_LIST_SCOPE");
      const rows = await db.db
        .select({
          organizationKind: pgSchema.organizations.kind,
          venue: pgSchema.exchangeCredentials.venue,
          credentialStatus: pgSchema.exchangeCredentials.status,
        })
        .from(pgSchema.exchangeCredentials)
        .innerJoin(
          pgSchema.organizations,
          eq(pgSchema.organizations.id, pgSchema.exchangeCredentials.organizationId),
        )
        .where(
          and(
            eq(pgSchema.organizations.id, organizationId),
            eq(pgSchema.organizations.kind, ADMIN_LISTED_ORGANIZATION_KIND),
            eq(pgSchema.exchangeCredentials.venue, ADMIN_LISTED_VENUE),
            eq(pgSchema.exchangeCredentials.status, ADMIN_LISTED_CREDENTIAL_STATUS),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row !== undefined && isAdminConnectedAccountScope(row);
    },
    async resolveActiveBinding(scope, _userId, signal) {
      return reader(signal).resolveActiveBinding({ organizationId: scope.organizationId,
        credentialId: scope.credentialId, exchangeAccountId: scope.exchangeAccountId }, signal);
    },
    async readFinancialHistory(input, signal) { return reader(signal).readFinancialHistory(input, signal); },
    async readLatest(binding, signal) { return reader(signal).readLatest(binding, signal); },
  };
  return { deps, async dispose() {
    disposed = true;
    projection?.dispose();
    await Promise.allSettled([
      access?.then(db => disposeWaiaRuntimeDb(db)),
    ]);
  } };
}

export async function accountObservationRoute(request: Request, surface: "tenant" | "admin",
  mode: "observation" | "binding" | "financial-history" = "observation") {
  const context = createAccountObservationRouteDependencies();
  try { return await handleAccountObservationGet(request, surface, context.deps, mode); }
  finally { await context.dispose(); }
}
