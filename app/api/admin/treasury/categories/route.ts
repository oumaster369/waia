import { runAdminRoute } from "@/lib/waia-core/permissions/admin-http-run";
import { createProductionAdminRouteDeps } from "@/lib/waia-core/permissions/admin-http-deps";
import {
  handleTreasuryLedgerCatalogGet,
  handleTreasuryLedgerCatalogPatch,
  handleTreasuryLedgerCatalogPost,
} from "@/lib/waia-core/treasury/admin/handlers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("admin_treasury_categories", () =>
    handleTreasuryLedgerCatalogGet(request, createProductionAdminRouteDeps(), "categories"),
  );
}

export async function POST(request: Request) {
  return runAdminRoute("admin_treasury_categories", () =>
    handleTreasuryLedgerCatalogPost(request, createProductionAdminRouteDeps(), "categories"),
  );
}

export async function PATCH(request: Request) {
  return runAdminRoute("admin_treasury_categories", () =>
    handleTreasuryLedgerCatalogPatch(request, createProductionAdminRouteDeps(), "categories"),
  );
}
