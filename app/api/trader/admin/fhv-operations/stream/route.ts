import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminFhvBrowserStream } from "@/lib/trader/observability/fhv-browser-stream-handler";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleAdminFhvBrowserStream(request, createProductionAdminRouteDeps());
}
