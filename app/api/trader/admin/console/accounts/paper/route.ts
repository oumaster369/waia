import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsolePaperPortfoliosGet } from "@/lib/trader/admin-console/handlers/paper-portfolios";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {return runAdminRoute("trader_admin_console_accounts", () => handleAdminConsolePaperPortfoliosGet(request,createProductionAdminRouteDeps()));}
