import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { serveAdminConsoleStream } from "@/lib/trader/admin-console/stream/console-stream";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return serveAdminConsoleStream(request, createProductionAdminRouteDeps());
}
