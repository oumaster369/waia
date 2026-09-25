import { withAdminRouteSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { sql } from "drizzle-orm";

import {
  adminSuccess,
  adminClientError,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import {
  adminScopeFromQuery,
  parseAdminConsoleQuery,
  periodBounds,
} from "@/lib/trader/admin-console/scope";
import { presentIncident } from "@/lib/trader/admin-console/diagnostics/incident-view";
import { redactDiagnosticText } from "@/lib/trader/admin-console/diagnostics/redact";

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

export async function handleAdminConsoleIncidentsGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
  incidentId?: string,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  if (incidentId && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(incidentId))
    return adminClientError(400, "BAD_REQUEST", "Incident id is invalid.");
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.incidents,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      if (!incidentId && parsed.query.tab === "events") {
        const bounds = periodBounds(parsed.query, new Date());
        const events =
          await tx.execute(sql`SELECT id::text, occurred_at, service, environment, severity, error_class, message_redacted, route
          FROM trader_admin_diagnostic_event
          WHERE (${parsed.query.organization_id ?? null}::uuid IS NULL OR organization_id = ${parsed.query.organization_id ?? null}::uuid)
            AND (${parsed.query.exchange_account_id ?? null}::text IS NULL OR exchange_account_id = ${parsed.query.exchange_account_id ?? null})
            AND occurred_at >= ${bounds.start}::timestamptz AND occurred_at < ${bounds.end}::timestamptz
          ORDER BY occurred_at DESC, id LIMIT ${parsed.query.limit}`);
        return adminSuccess(
          adminEnvelope({
            scope: adminScopeFromQuery(parsed.query),
            mode: parsed.query.mode,
            data: {
              items: [...events].map((row) => ({
                id: String(row.id),
                occurredAt: new Date(String(row.occurred_at)).toISOString(),
                service: String(row.service),
                environment: String(row.environment),
                severity: String(row.severity),
                errorClass: String(row.error_class),
                message: redactDiagnosticText(String(row.message_redacted)),
                route: row.route ? String(row.route) : null,
              })),
            },
          }),
          "postgres",
        );
      }
      const rows = rowsOf(
        await tx.execute(sql`
        SELECT id::text AS id,
               environment,
               service,
               fingerprint,
               title,
               severity,
               status,
               first_seen_at,
               last_seen_at,
               occurrences,
               affected_accounts,
               muted_until,
               state_version
        FROM trader_admin_incident
        WHERE (${parsed.query.organization_id ?? null}::uuid IS NULL OR EXISTS (
          SELECT 1 FROM trader_admin_diagnostic_event scoped_diagnostic
          WHERE scoped_diagnostic.environment = trader_admin_incident.environment
            AND scoped_diagnostic.service = trader_admin_incident.service
            AND scoped_diagnostic.fingerprint = trader_admin_incident.fingerprint
            AND scoped_diagnostic.organization_id = ${parsed.query.organization_id ?? null}::uuid
            AND (${parsed.query.exchange_account_id ?? null}::text IS NULL OR scoped_diagnostic.exchange_account_id = ${parsed.query.exchange_account_id ?? null})
        ))
        AND (${incidentId ?? null}::uuid IS NULL OR id = ${incidentId ?? null}::uuid)
        AND (${incidentId ?? null}::uuid IS NOT NULL OR ${parsed.query.tab ?? "active"} = 'all'
          OR (${parsed.query.tab ?? "active"} = 'resolved' AND status = 'resolved')
          OR (${parsed.query.tab ?? "active"} <> 'resolved' AND status <> 'resolved'))
        ORDER BY last_seen_at DESC, id
        LIMIT ${parsed.query.limit}
      `),
      );
      if (incidentId && !rows.length)
        return adminClientError(404, "NOT_FOUND", "Incident not found in scope.");
      const history = incidentId
        ? [
            ...(await tx.execute(sql`SELECT id::text,from_status,to_status,actor_user_id::text,reason,evidence,created_at::text
        FROM trader_admin_incident_event WHERE incident_id=${incidentId}::uuid ORDER BY created_at DESC,id LIMIT 201`)),
          ]
        : [];
      const events = incidentId
        ? [
            ...(await tx.execute(sql`SELECT id::text,occurred_at::text,severity,error_class,message_redacted,route
        FROM trader_admin_diagnostic_event WHERE environment=${rows[0]!.environment} AND service=${rows[0]!.service} AND fingerprint=${rows[0]!.fingerprint}
        AND (${parsed.query.organization_id ?? null}::uuid IS NULL OR organization_id=${parsed.query.organization_id ?? null}::uuid)
        AND (${parsed.query.exchange_account_id ?? null}::text IS NULL OR exchange_account_id=${parsed.query.exchange_account_id ?? null})
        ORDER BY occurred_at DESC,id LIMIT 101`)),
          ]
        : [];
      return adminSuccess(
        adminEnvelope({
          data: incidentId
            ? {
                incident: presentIncident(rows[0]!),
                history: history
                  .slice(0, 200)
                  .map((r) => ({
                    id: String(r.id),
                    from: r.from_status,
                    to: r.to_status,
                    actor: r.actor_user_id,
                    reason: redactDiagnosticText(String(r.reason ?? "")),
                    evidence: r.evidence ? redactDiagnosticText(String(r.evidence)) : null,
                    at: String(r.created_at),
                  })),
                events: events
                  .slice(0, 100)
                  .map((r) => ({
                    id: String(r.id),
                    at: String(r.occurred_at),
                    severity: String(r.severity),
                    errorClass: String(r.error_class),
                    message: redactDiagnosticText(String(r.message_redacted)),
                    route: r.route,
                  })),
                truncated: history.length > 200 || events.length > 100,
              }
            : { items: rows.map(presentIncident) },
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
