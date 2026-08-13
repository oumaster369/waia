import { runAdminRoute } from "@/lib/waia-core/permissions/admin-http-run";
import { createProductionAdminRouteDeps } from "@/lib/waia-core/permissions/admin-http-deps";
import { handleTreasuryBreathPreviewGet } from "@/lib/waia-core/treasury/admin/handlers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("admin_treasury_breath_preview", () =>
    handleTreasuryBreathPreviewGet(request, createProductionAdminRouteDeps()),
  );
}
