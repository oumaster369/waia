import { runAdminRoute } from "@/lib/trader/admin-route-http";
import {
  createProductionOrg0ReadOnlyConnectDeps,
  handleOrg0ReadOnlyConnectGet,
  handleOrg0ReadOnlyConnectPost,
} from "@/lib/trader/credentials/org0-readonly-connect-handler";

export const dynamic = "force-dynamic";

/** Fixed Org0 HTX observation credential metadata; no enrollment or decryption. */
export async function GET() {
  return runAdminRoute("trader_admin_org0_readonly_connect", () =>
    handleOrg0ReadOnlyConnectGet(createProductionOrg0ReadOnlyConnectDeps()));
}

/** Exact-target, read-only HTX credential validation and canonical encrypted rotation. */
export async function POST(request: Request) {
  return runAdminRoute("trader_admin_org0_readonly_connect", () =>
    handleOrg0ReadOnlyConnectPost(request, createProductionOrg0ReadOnlyConnectDeps()));
}
