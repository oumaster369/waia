import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { serializeCredentialMetadata } from "@/lib/trader/admin-serialize";
import {
  adminClientError,
  adminSuccess,
  authorizeAdminRoute,
  mapServiceError,
  parseOrganizationId,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import {
  createPostgresCredentialService,
  createSqliteCredentialService,
} from "@/lib/trader/credentials/credential-service";
import { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

function createCredentialService(
  runtime: Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>,
) {
  const createProvider = () => createMasterKeyProvider();
  if (runtime.kind === "sqlite") {
    return createSqliteCredentialService(runtime.db, { createProvider });
  }
  return createPostgresCredentialService(runtime.db, { createProvider });
}

export async function handleAdminExchangeCredentialsGet(
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
    const context = requireOrgContext(orgParsed);
    context.userId = auth.userId;

    const service = createCredentialService(runtime);
    const rows = await service.listCredentialMetadata(context);

    return adminSuccess({ credentials: rows.map(serializeCredentialMetadata) }, runtime.kind);
  } catch (err) {
    return mapServiceError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}
