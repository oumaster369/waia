import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import {
  handleAdminConsoleKillSwitchGet,
  handleAdminConsoleKillSwitchPost,
} from "@/lib/trader/admin-console/handlers/kill-switch";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_console_kill_switch", () =>
    handleAdminConsoleKillSwitchGet(request, createProductionAdminRouteDeps()),
  );
}
export async function POST(request: Request) {
  return runAdminRoute("trader_admin_console_kill_switch", () =>
    handleAdminConsoleKillSwitchPost(request, createProductionAdminRouteDeps()),
  );
}
