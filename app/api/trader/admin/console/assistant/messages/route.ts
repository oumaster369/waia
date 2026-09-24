import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleAssistantMessagesPost } from "@/lib/trader/admin-console/handlers/assistant-messages";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return runAdminRoute("trader_admin_console_assistant_messages", () =>
    handleAdminConsoleAssistantMessagesPost(request, createProductionAdminRouteDeps()),
  );
}
