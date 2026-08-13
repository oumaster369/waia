import { runAdminRoute } from "@/lib/waia-core/permissions/admin-http-run";
import { createProductionAdminRouteDeps } from "@/lib/waia-core/permissions/admin-http-deps";
import {
  handleTreasuryIdealBudgetsGet,
  handleTreasuryIdealBudgetsPost,
} from "@/lib/waia-core/treasury/admin/handlers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("admin_treasury_ideal_budgets", () =>
    handleTreasuryIdealBudgetsGet(request, createProductionAdminRouteDeps()),
  );
}

export async function POST(request: Request) {
  return runAdminRoute("admin_treasury_ideal_budgets", () =>
    handleTreasuryIdealBudgetsPost(request, createProductionAdminRouteDeps()),
  );
}
