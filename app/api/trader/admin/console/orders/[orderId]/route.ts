import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleOrderDetailGet } from "@/lib/trader/admin-console/handlers/order-detail";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  return runAdminRoute("trader_admin_console_order_detail", () =>
    handleAdminConsoleOrderDetailGet(request, createProductionAdminRouteDeps(), orderId),
  );
}
