import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleCycleTraceGet } from "@/lib/trader/admin-console/handlers/cycle-trace";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ envelopeId: string }> }) {
  const { envelopeId } = await context.params;
  return runAdminRoute("trader_admin_console_cycle_trace", () =>
    handleAdminConsoleCycleTraceGet(request, createProductionAdminRouteDeps(), envelopeId),
  );
}
