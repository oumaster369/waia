import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminKillSwitchesGet } from "@/lib/trader/risk/kill-switch/admin-route-handler";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/kill-switches — list or single kill switch read. */
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_kill_switches", () =>
    handleAdminKillSwitchesGet(request, createProductionAdminRouteDeps()),
  );
}
