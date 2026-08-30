import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") require("server-only");

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { createSqliteRuntimeAuthorityAssessmentRepositoryV2 } from "./runtime-authority-repository-sqlite-v2";
import { createPostgresRuntimeAuthorityAssessmentRepositoryV2 } from "./runtime-authority-repository-postgres-v2";
import { readLatestTenantRuntimeAuthorityV2 } from "./runtime-authority-read-model-v2";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

export type RuntimeAuthorityHttpResult = { status: number; body: unknown; runtime?: "sqlite" | "postgres" };
export type TenantRuntimeAuthorityHttpDeps = {
  getUserId(): Promise<string | null>;
  hasTraderAccess(userId: string): Promise<boolean>;
  getRuntimeDb(): Promise<WaiaRuntimeDb>;
  disposeRuntimeDb(runtime: WaiaRuntimeDb | undefined): Promise<unknown>;
};

export async function handleTenantRuntimeAuthorityGet(request: Request, deps: TenantRuntimeAuthorityHttpDeps): Promise<RuntimeAuthorityHttpResult> {
  const url = new URL(request.url);
  if (url.searchParams.has("organization_id") || url.searchParams.has("organizationId")) {
    return { status: 400, body: { error: { code: "ORG_SCOPE_FORBIDDEN", message: "Organization scope comes from the session." } } };
  }
  const userId = await deps.getUserId();
  if (!userId) return { status: 401, body: { error: { code: "UNAUTHORIZED", message: "Session required." } } };
  if (!await deps.hasTraderAccess(userId)) return { status: 403, body: { error: { code: "FORBIDDEN", message: "Trader entitlement required." } } };
  let runtime: WaiaRuntimeDb | undefined;
  try {
    runtime = await deps.getRuntimeDb();
    const repository = runtime.kind === "sqlite"
      ? createSqliteRuntimeAuthorityAssessmentRepositoryV2(runtime.db)
      : createPostgresRuntimeAuthorityAssessmentRepositoryV2(runtime.db);
    const organizationId = personalOrganizationIdFromUserId(userId);
    const posture = await readLatestTenantRuntimeAuthorityV2(repository, { organizationId, userId });
    return { status: 200, body: { runtimeAuthority: posture }, runtime: runtime.kind };
  } finally { await deps.disposeRuntimeDb(runtime); }
}
