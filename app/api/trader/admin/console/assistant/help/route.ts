import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleAssistantHelpGet } from "@/lib/trader/admin-console/handlers/assistant-help";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("trader_admin_console_assistant_help", () =>
    handleAdminConsoleAssistantHelpGet(request, createProductionAdminRouteDeps()),
  );
}
