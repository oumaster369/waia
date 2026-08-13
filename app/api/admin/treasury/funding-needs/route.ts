import { runAdminRoute } from "@/lib/waia-core/permissions/admin-http-run";
import { createProductionAdminRouteDeps } from "@/lib/waia-core/permissions/admin-http-deps";
import {
  handleTreasuryFundingNeedsGet,
  handleTreasuryFundingNeedsPatch,
  handleTreasuryFundingNeedsPost,
} from "@/lib/waia-core/treasury/admin/handlers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("admin_treasury_funding_needs", () =>
    handleTreasuryFundingNeedsGet(request, createProductionAdminRouteDeps()),
  );
}

export async function POST(request: Request) {
  return runAdminRoute("admin_treasury_funding_needs", () =>
    handleTreasuryFundingNeedsPost(request, createProductionAdminRouteDeps()),
  );
}

export async function PATCH(request: Request) {
  return runAdminRoute("admin_treasury_funding_needs", () =>
    handleTreasuryFundingNeedsPatch(request, createProductionAdminRouteDeps()),
  );
}
