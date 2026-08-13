import { runAdminRoute } from "@/lib/waia-core/permissions/admin-http-run";
import { createProductionAdminRouteDeps } from "@/lib/waia-core/permissions/admin-http-deps";
import {
  handleTreasuryEvidenceGet,
  handleTreasuryEvidencePost,
} from "@/lib/waia-core/treasury/admin/handlers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("admin_treasury_evidence", () =>
    handleTreasuryEvidenceGet(request, createProductionAdminRouteDeps()),
  );
}

export async function POST(request: Request) {
  return runAdminRoute("admin_treasury_evidence", () =>
    handleTreasuryEvidencePost(request, createProductionAdminRouteDeps()),
  );
}
