import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleAccountDetailGet } from "@/lib/trader/admin-console/handlers/account-detail";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await context.params;
  return runAdminRoute("trader_admin_console_account_detail", () =>
    handleAdminConsoleAccountDetailGet(request, createProductionAdminRouteDeps(), accountId),
  );
}
