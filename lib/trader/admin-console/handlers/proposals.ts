import { withAdminRouteSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { sql } from "drizzle-orm";

import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { presentPromotionProposal } from "@/lib/trader/admin-console/research/promotion-proposal";
import {
  adminScopeFromQuery,
  parseAdminConsoleQuery,
  periodBounds,
} from "@/lib/trader/admin-console/scope";

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export async function handleAdminConsoleProposalsGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.proposals,
  });
  if (!opened.ok) return opened.result;
  const organizationId = parsed.query.organization_id ?? null;
  const bounds = periodBounds(parsed.query, new Date());
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      if (parsed.query.exchange_account_id)
        return adminSuccess(
          adminEnvelope({
            data: {
              state: "not_applicable",
              items: [],
              reasons: ["PROPOSED_ACCOUNT_ASSIGNMENTS_NOT_PERSISTED"],
            },
            scope: adminScopeFromQuery(parsed.query),
            mode: parsed.query.mode,
          }),
          "postgres",
        );
      const rows = rowsOf(
        await tx.execute(sql`
        SELECT id::text AS id,
               organization_id::text AS organization_id,
               disposition,
               created_at,
               payload_json
        FROM trader_human_promotion_proposal_v2
        WHERE (${organizationId}::uuid IS NULL OR organization_id = ${organizationId}::uuid)
          AND created_at>=${bounds.start}::timestamptz AND created_at<${bounds.end}::timestamptz
        ORDER BY created_at DESC, id
        LIMIT ${parsed.query.limit}
      `),
      );
      return adminSuccess(
        adminEnvelope({
          data: {
            items: rows.map((row) =>
              presentPromotionProposal({
                id: String(row.id),
                organizationId: String(row.organization_id),
                disposition: String(row.disposition),
                createdAt: iso(row.created_at),
                payloadJson: String(row.payload_json ?? ""),
              }),
            ),
          },
          scope: adminScopeFromQuery(parsed.query),
          mode: parsed.query.mode,
        }),
        "postgres",
      );
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
