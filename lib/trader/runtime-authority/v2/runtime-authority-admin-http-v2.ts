import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") require("server-only");

import { adminSuccess, authorizeAdminRoute, parseOrganizationId,
  type AdminRouteHandlerDeps, type AdminRouteHandlerResult } from "@/lib/trader/admin-route-shared";
import { createSqliteRuntimeAuthorityAssessmentRepositoryV2 } from "./runtime-authority-repository-sqlite-v2";
import { createPostgresRuntimeAuthorityAssessmentRepositoryV2 } from "./runtime-authority-repository-postgres-v2";
import { readLatestTenantRuntimeAuthorityV2 } from "./runtime-authority-read-model-v2";

export async function handleAdminRuntimeAuthorityGet(request: Request, deps: AdminRouteHandlerDeps): Promise<AdminRouteHandlerResult> {
  const parsed = parseOrganizationId(new URL(request.url));
  if (typeof parsed !== "string") return parsed;
  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, parsed, "admin.audit.read");
    if (!auth.ok) return auth.result;
    runtime = auth.runtime;
    const repository = runtime.kind === "sqlite"
      ? createSqliteRuntimeAuthorityAssessmentRepositoryV2(runtime.db)
      : createPostgresRuntimeAuthorityAssessmentRepositoryV2(runtime.db);
    const posture = await readLatestTenantRuntimeAuthorityV2(repository, { organizationId: parsed });
    return adminSuccess({ runtimeAuthority: posture }, runtime.kind);
  } finally { await deps.disposeRuntimeDb(runtime); }
}
