import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsolePromotionCommandPost } from "@/lib/trader/admin-console/handlers/promotion-commands";
export const dynamic = "force-dynamic";
/** Existing governed service; console response excludes qualification document payloads. */
export async function POST(request: Request) {
  return runAdminRoute("trader_admin_console_promotion_commands", () =>
    handleAdminConsolePromotionCommandPost(request, createProductionAdminRouteDeps()),
  );
}
