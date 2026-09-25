import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  adminClientError,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { handleAdminStrategyPromotionCommandPost } from "@/lib/trader/validation-gate/admin-route-handler";
import { openAdminConsole } from "./guard";
import { HANDLER_TABLES } from "../handler-tables";
import { adminRevision } from "../revision";
import { staleRevisionResult } from "../auth";
import { readConsolePromotionState } from "@/lib/trader/admin-console/repositories/promotion-state.postgres";
import { parseAdminConsoleQuery } from "../scope";
const commandIdentity = z.object({
  organization_id: z.string().uuid(),
  command: z.string().min(1),
  expectedRevision: z.string().min(1),
  strategy_id: z.string().trim().min(1).max(200).optional(),
});
class RollbackResult {
  constructor(readonly result: AdminRouteHandlerResult) {}
}
/** Transactional console adapter; all policy and evidence validation stays in the existing service. */
export async function handleAdminConsolePromotionCommandPost(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const query = parseAdminConsoleQuery(new URL(request.url));
  if (!query.ok) return query.result;
  const opened = await openAdminConsole(request, deps, {
    mutate: true,
    requiredTables: HANDLER_TABLES.promotionCommands,
  });
  if (!opened.ok) return opened.result;
  try {
    const raw = await request
        .clone()
        .json()
        .catch(() => null),
      parsed = commandIdentity.safeParse(raw);
    if (!parsed.success)
      return adminClientError(
        400,
        "EXPECTED_REVISION_REQUIRED",
        "Read the promotion state before a command.",
      );
    const body = parsed.data;
    if (
      query.query.exchange_account_id ||
      (query.query.organization_id && query.query.organization_id !== body.organization_id)
    )
      return adminClientError(404, "NOT_FOUND", "Promotion not found in scope.");
    return await opened.runtime.db.transaction(async (tx) => {
      // Serializes console commands, including creation from the empty state.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`admin-console-promotions:${body.organization_id}`},0))`,
      );
      if (body.command === "request") {
        if (!body.strategy_id)
          return adminClientError(400, "STRATEGY_ID_REQUIRED", "Strategy required.");
        const current = await readConsolePromotionState(tx, body.organization_id, body.strategy_id);
        if (body.expectedRevision !== adminRevision(current)) return staleRevisionResult(current);
        if ("state" in current)
          return adminClientError(
            409,
            "PROMOTION_STATE_AMBIGUOUS",
            "Resolve the existing promotion state.",
          );
      }
      const result = await handleAdminStrategyPromotionCommandPost(
        request,
        {
          ...deps,
          getRuntimeDb: async () => ({
            ...opened.runtime,
            db: tx as unknown as typeof opened.runtime.db,
          }),
          disposeRuntimeDb: async () => undefined,
        },
        { consoleMetadataOnly: true },
      );
      // A service can map a failed audit/write to an HTTP result. It still must roll back.
      if (result.status >= 400) throw new RollbackResult(result);
      return result;
    });
  } catch (error) {
    if (error instanceof RollbackResult) return error.result;
    throw error;
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
