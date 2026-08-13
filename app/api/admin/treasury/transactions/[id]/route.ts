import { runAdminRoute } from "@/lib/waia-core/permissions/admin-http-run";
import { createProductionAdminRouteDeps } from "@/lib/waia-core/permissions/admin-http-deps";
import { handleTreasuryTransactionByIdGet } from "@/lib/waia-core/treasury/admin/handlers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return runAdminRoute("admin_treasury_transactions", () =>
    handleTreasuryTransactionByIdGet(request, createProductionAdminRouteDeps(), id),
  );
}
