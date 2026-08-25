import { runAdminRoute } from "@/lib/waia-core/permissions/admin-http-run";
import { createProductionAdminRouteDeps } from "@/lib/waia-core/permissions/admin-http-deps";
import { handleFinanceAssistantExecutePost } from "@/lib/waia-core/treasury/admin/handlers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return runAdminRoute("admin_treasury_finance_assistant_execute", () =>
    handleFinanceAssistantExecutePost(request, createProductionAdminRouteDeps()),
  );
}
