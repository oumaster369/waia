import { runAdminRoute } from "@/lib/waia-core/permissions/admin-http-run";
import { createProductionAdminRouteDeps } from "@/lib/waia-core/permissions/admin-http-deps";
import {
  handleTreasuryLedgerCatalogGet,
  handleTreasuryLedgerCatalogPatch,
  handleTreasuryLedgerCatalogPost,
} from "@/lib/waia-core/treasury/admin/handlers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("admin_treasury_accounts", () =>
    handleTreasuryLedgerCatalogGet(request, createProductionAdminRouteDeps(), "accounts"),
  );
}

export async function POST(request: Request) {
  return runAdminRoute("admin_treasury_accounts", () =>
    handleTreasuryLedgerCatalogPost(request, createProductionAdminRouteDeps(), "accounts"),
  );
}

export async function PATCH(request: Request) {
  return runAdminRoute("admin_treasury_accounts", () =>
    handleTreasuryLedgerCatalogPatch(request, createProductionAdminRouteDeps(), "accounts"),
  );
}
