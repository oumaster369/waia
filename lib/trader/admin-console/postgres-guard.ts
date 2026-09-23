import type { AdminRouteHandlerResult } from "@/lib/trader/admin-route-shared";
import { adminSuccess } from "@/lib/trader/admin-route-shared";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";

export function requirePostgres(runtime: WaiaRuntimeDb): AdminRouteHandlerResult | null {
  if (runtime.kind !== "sqlite") return null;
  return adminSuccess(
    adminEnvelope({
      data: {
        state: "unavailable",
        reasons: [ADMIN_REASON.postgresRequired],
      },
      scope: { kind: "fleet" },
      missingSources: [ADMIN_REASON.postgresRequired],
    }),
    "sqlite",
  );
}

export function schemaNotAppliedResult(): AdminRouteHandlerResult {
  return adminSuccess(
    adminEnvelope({
      data: {
        state: "unavailable",
        reasons: [ADMIN_REASON.schemaNotApplied],
      },
      scope: { kind: "fleet" },
      missingSources: [ADMIN_REASON.schemaNotApplied],
    }),
    "postgres",
  );
}
