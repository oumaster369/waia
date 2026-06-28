import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { probeExecutionHostHealth } from "@/lib/trader/live/execution-host-health";
import {
  adminSuccess,
  authorizeAdminRoute,
  parseOrganizationId,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";

export async function handleAdminRuntimeHealth(
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

    const healthy = await probeExecutionHostHealth(process.env);
    return adminSuccess(
      {
        executionHostHealthy: healthy,
        executionHostConfigured: Boolean(process.env.WAIA_TRADER_EXECUTION_HOST_URL?.trim()),
      },
      runtime.kind,
    );
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}
