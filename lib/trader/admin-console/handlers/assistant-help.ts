import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { authorizeFleetAdmin } from "@/lib/trader/admin-console/auth";
import { assistantHelpEntries } from "@/lib/trader/admin-console/assistant/help";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";

export async function handleAdminConsoleAssistantHelpGet(
  _request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const auth = await authorizeFleetAdmin(deps, "admin.audit.read");
  if (!auth.ok) return auth.result;
  try {
    return adminSuccess(
      adminEnvelope({
        data: { entries: assistantHelpEntries() },
        scope: { kind: "fleet" },
      }),
      auth.runtime.kind === "sqlite" ? "sqlite" : "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(auth.runtime);
  }
}
