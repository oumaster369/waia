import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleAssistantConversationGet } from "@/lib/trader/admin-console/handlers/assistant-conversations";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return runAdminRoute("trader_admin_console_assistant_conversation", () =>
    handleAdminConsoleAssistantConversationGet(request, createProductionAdminRouteDeps(), id),
  );
}
