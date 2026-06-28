import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminKillSwitchCommandPost } from "@/lib/trader/risk/kill-switch/admin-route-handler";

export const dynamic = "force-dynamic";

/** POST /api/trader/admin/kill-switches/commands — governed kill switch mutations. */
export async function POST(request: Request) {
  return runAdminRoute("trader_admin_kill_switch_commands", () =>
    handleAdminKillSwitchCommandPost(request, createProductionAdminRouteDeps()),
  );
}
