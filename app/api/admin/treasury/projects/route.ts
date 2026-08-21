import { runAdminRoute } from "@/lib/waia-core/permissions/admin-http-run";
import { createProductionAdminRouteDeps } from "@/lib/waia-core/permissions/admin-http-deps";
import {
  handleTreasuryLedgerCatalogGet,
  handleTreasuryLedgerCatalogPatch,
  handleTreasuryLedgerCatalogPost,
} from "@/lib/waia-core/treasury/admin/handlers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("admin_treasury_projects", () =>
    handleTreasuryLedgerCatalogGet(request, createProductionAdminRouteDeps(), "projects"),
  );
}

export async function POST(request: Request) {
  return runAdminRoute("admin_treasury_projects", () =>
    handleTreasuryLedgerCatalogPost(request, createProductionAdminRouteDeps(), "projects"),
  );
}

export async function PATCH(request: Request) {
  return runAdminRoute("admin_treasury_projects", () =>
    handleTreasuryLedgerCatalogPatch(request, createProductionAdminRouteDeps(), "projects"),
  );
}
