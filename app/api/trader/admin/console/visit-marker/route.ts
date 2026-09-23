import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import {
  handleAdminConsoleVisitMarkerGet,
  handleAdminConsoleVisitMarkerPost,
} from "@/lib/trader/admin-console/handlers/visit-marker";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("trader_admin_console_visit_marker", () =>
    handleAdminConsoleVisitMarkerGet(request, createProductionAdminRouteDeps()),
  );
}

export async function POST(request: Request) {
  return runAdminRoute("trader_admin_console_visit_marker", () =>
    handleAdminConsoleVisitMarkerPost(request, createProductionAdminRouteDeps()),
  );
}
