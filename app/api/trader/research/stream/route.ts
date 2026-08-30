import { handleTenantFhvBrowserStream } from "@/lib/trader/observability/fhv-browser-stream-handler";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleTenantFhvBrowserStream(request);
}
