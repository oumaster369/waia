import {
  adminClientError,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { handleAdminConsoleInvoicesGet } from "@/lib/trader/admin-console/handlers/invoices";
import { handleAdminConsoleOverviewGet } from "@/lib/trader/admin-console/handlers/overview";
/** Reuse full canonical aggregates, never add an independently truncated list. Native currencies stay separate. */
export async function handleAdminConsoleAggregateGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const params = new URL(request.url).searchParams;
  const dataset = params.get("dataset") ?? "invoices";
  if (
    (params.has("dimension") && params.get("dimension") !== "currency") ||
    (params.has("measure") && !["count", "sum_amount"].includes(params.get("measure")!))
  )
    return adminClientError(
      400,
      "AGGREGATE_MEASURE_UNSUPPORTED",
      "Only the canonical currency-grouped aggregate is available.",
    );
  if (dataset === "invoices") return handleAdminConsoleInvoicesGet(request, deps);
  if (dataset === "portfolio") return handleAdminConsoleOverviewGet(request, deps);
  return adminClientError(
    400,
    "AGGREGATE_DATASET_UNSUPPORTED",
    "Use the canonical invoices or portfolio aggregate; arbitrary measures are not supported.",
  );
}
