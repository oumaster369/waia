import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminExchangeCredentialsGet } from "@/lib/trader/credentials/admin-route-handler";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/exchange-credentials — credential metadata list. */
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_exchange_credentials", () =>
    handleAdminExchangeCredentialsGet(request, createProductionAdminRouteDeps()),
  );
}
