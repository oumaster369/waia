import { sql } from "drizzle-orm";
import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { withAdminRouteSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { organizationFilter } from "@/lib/trader/admin-console/sql/read-scope";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import type {
  ResearchCatalog,
  ResearchCatalogItem,
} from "@/lib/trader/admin-console/research/catalog";

export async function handleAdminConsoleResearchCatalogGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const query = parsed.query;
  const tab = query.tab ?? "campaigns";
  if (!["campaigns", "knowledge", "qualification"].includes(tab))
    return adminClientError(400, "BAD_REQUEST", "Unknown research catalogue.");
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.researchCatalog,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const scope = adminScopeFromQuery(query);
      if (query.exchange_account_id)
        return adminSuccess(
          adminEnvelope<ResearchCatalog>({
            scope,
            mode: query.mode,
            data: {
              items: [],
              total: null,
              state: "not_applicable",
              reasons: ["RESEARCH_EXCHANGE_ACCOUNT_BINDING_NOT_PERSISTED"],
              modeApplicability: "research_metadata",
            },
          }),
          "postgres",
        );
      // Explicit columns: never SELECT * or read sealed dataset/holdout/reasoning payloads.
      const selection =
        tab === "campaigns"
          ? sql`
        SELECT id::text, organization_id::text, 'campaign' AS kind, name AS title,
          current_state AS state, NULL::text AS version, symbol_scope AS symbol,
          created_at AS observed_at, dataset_digest AS evidence_ref
        FROM trader_discovery_research_campaign WHERE ${organizationFilter(query)}`
          : tab === "knowledge"
            ? sql`
        SELECT h.id::text, h.organization_id::text, 'hypothesis' AS kind, h.name AS title,
          lifecycle.lifecycle_state::text AS state, h.version_seq::text AS version,
          NULL::text AS symbol, h.created_at AS observed_at, h.definition_digest AS evidence_ref
        FROM trader_mi_hypothesis h
        LEFT JOIN LATERAL (SELECT lifecycle_state FROM trader_mi_hypothesis_lifecycle l
          WHERE l.organization_id = h.organization_id AND l.hypothesis_id = h.id
          ORDER BY l.seq DESC LIMIT 1) lifecycle ON true
        WHERE ${organizationFilter(query, "h")}
        UNION ALL
        SELECT id::text, organization_id::text, 'edge', from_ref || ' → ' || to_ref,
          CASE WHEN verified THEN 'VERIFIED' ELSE 'UNVERIFIED' END, NULL, regime_scope, updated_at, hypothesis_id::text
        FROM trader_knowledge_edges WHERE ${organizationFilter(query)}`
            : sql`
        SELECT id::text, organization_id::text, 'dataset' AS kind, name AS title,
          'SEALED' AS state, NULL::text AS version, symbol, sealed_at AS observed_at,
          NULL::text AS evidence_ref
        FROM research_dataset WHERE ${organizationFilter(query)}
        UNION ALL
        SELECT id::text, organization_id::text, 'qualification', strategy_id,
          status::text, strategy_version, NULL, updated_at, trial_id::text
        FROM trader_strategy_candidates WHERE ${organizationFilter(query)}`;
      const result = await tx.execute(sql`WITH catalogue AS (${selection})
        SELECT *, count(*) OVER()::text AS total FROM catalogue
        WHERE (${query.status ?? null}::text IS NULL OR (${query.status ?? null} = 'inactive' AND kind = 'campaign' AND state IN ('DRAFT', 'PAUSED', 'ARCHIVED'))) ORDER BY observed_at DESC NULLS LAST, id LIMIT ${query.limit}`);
      const rows = Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
      const items: ResearchCatalogItem[] = rows.map((row) => ({
        id: String(row.id),
        organizationId: String(row.organization_id),
        kind: String(row.kind) as ResearchCatalogItem["kind"],
        title: String(row.title),
        state: row.state == null ? null : String(row.state),
        version: row.version == null ? null : String(row.version),
        symbol: row.symbol == null ? null : String(row.symbol),
        observedAt:
          row.observed_at instanceof Date
            ? row.observed_at.toISOString()
            : row.observed_at == null
              ? null
              : String(row.observed_at),
        evidenceRef: row.evidence_ref == null ? null : String(row.evidence_ref),
      }));
      const total = Number(rows[0]?.total ?? 0);
      const reasons = total > items.length ? ["LIST_TRUNCATED"] : [];
      return adminSuccess(
        adminEnvelope<ResearchCatalog>({
          scope,
          mode: query.mode,
          data: {
            items,
            total,
            reasons,
            state: reasons.length ? "partial" : items.length ? "ok" : "empty",
            modeApplicability: "research_metadata",
          },
        }),
        "postgres",
      );
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
