import { enforceServerOnly } from "@/lib/enforce-server-only";
import { adminClientError, adminSuccess, authorizeAdminRoute, type AdminRouteHandlerDeps, type AdminRouteHandlerResult } from "@/lib/trader/admin-route-shared";
import { createAdminServiceOrgAccess } from "@/lib/trader/security/admin-service-org-access";
import { OrgScopeError } from "@/lib/waia-core/scope/org-context";
import { assertReportingPeriodBasisReadScope, readReportingPeriodBasisV1Postgres } from "./v2/reporting-period-basis-postgres-v1";
import { ReportingPeriodBasisError, type ReportingPeriodBasisCode } from "./v2/reporting-period-basis-v1";

enforceServerOnly();
const HTTP_STATUS: Record<ReportingPeriodBasisCode, number> = {
  BASIS_INVALID_INPUT: 400, BASIS_TRANSACTION_OWNER_REQUIRED: 400, BASIS_PERIOD_NOT_FOUND: 404,
  PERIOD_NOT_CLOSED: 409, BASIS_SCHEMA_UNAVAILABLE: 503, BASIS_VERSION_UNSUPPORTED: 422,
  BASIS_CONTENT_INVALID: 409, BASIS_PERIOD_MISMATCH: 409, BASIS_SOURCE_REPLAY_UNAVAILABLE: 503,
  BASIS_SOURCE_REPLAY_MISMATCH: 409, BASIS_CAPACITY_EXCEEDED: 413,
};

export async function handleAdminReportingPeriodBasisGet(request: Request, periodId: string,
  deps: AdminRouteHandlerDeps): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organization_id") ?? "";
  const input = { periodId, exchangeAccountId: url.searchParams.get("exchange_account_id") ?? "" };
  // Keep exact account bytes. Whitespace inside a nonempty account is not an alias.
  try { assertReportingPeriodBasisReadScope({ organizationId }, input); }
  catch { return adminClientError(400, "BASIS_INVALID_INPUT", "Exact organization, account and period identifiers are required."); }
  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, organizationId, "admin.audit.read");
    if (!auth.ok) return auth.result;
    runtime = auth.runtime;
    if (runtime.kind !== "postgres") return adminClientError(503, "BASIS_SCHEMA_UNAVAILABLE", "Reporting-period basis requires PostgreSQL.");
    const result = await readReportingPeriodBasisV1Postgres(runtime.db, { organizationId, userId: auth.userId }, input, {
      assertMembership: (context, bound) => createAdminServiceOrgAccess({ kind: "postgres", db: bound }, "admin.audit.read")(context),
    });
    return adminSuccess(result, "postgres");
  } catch (error) {
    if (error instanceof ReportingPeriodBasisError) return adminClientError(HTTP_STATUS[error.code], error.code, error.code);
    if (error instanceof OrgScopeError) return adminClientError(403, "FORBIDDEN", "Admin permission required.");
    // Do not use generic mapServiceError: unexpected storage faults must reach500.
    throw error;
  } finally { if (runtime) await deps.disposeRuntimeDb(runtime); }
}
