import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleAssistantQuickAnswersGet } from "@/lib/trader/admin-console/handlers/assistant-quick-answers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("trader_admin_console_assistant_quick_answers", () =>
    handleAdminConsoleAssistantQuickAnswersGet(request, createProductionAdminRouteDeps()),
  );
}
