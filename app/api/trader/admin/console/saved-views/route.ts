import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import {
  handleAdminConsoleSavedViewsDelete,
  handleAdminConsoleSavedViewsGet,
  handleAdminConsoleSavedViewsPost,
} from "@/lib/trader/admin-console/handlers/saved-views";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("trader_admin_console_saved_views", () =>
    handleAdminConsoleSavedViewsGet(request, createProductionAdminRouteDeps()),
  );
}

export async function POST(request: Request) {
  return runAdminRoute("trader_admin_console_saved_views", () =>
    handleAdminConsoleSavedViewsPost(request, createProductionAdminRouteDeps()),
  );
}

export async function DELETE(request: Request) {
  return runAdminRoute("trader_admin_console_saved_views", () =>
    handleAdminConsoleSavedViewsDelete(request, createProductionAdminRouteDeps()),
  );
}
