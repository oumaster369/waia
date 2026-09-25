import { sql } from "drizzle-orm";
import { z } from "zod";
import { traderAdminIncidentEvent } from "@/db/schema.postgres";
import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import { staleRevisionResult } from "@/lib/trader/admin-console/auth";
import { presentIncident } from "@/lib/trader/admin-console/diagnostics/incident-view";
import {
  INCIDENT_STATUSES,
  nextIncidentStatus,
  type IncidentStatus,
} from "@/lib/trader/admin-console/diagnostics/incident-transition";

const statusSchema = z
  .object({
    id: z.string().uuid(),
    expectedRevision: z.string().min(1),
    status: z.enum(INCIDENT_STATUSES),
    reason: z.string().trim().min(1).max(2000),
    evidence: z.string().trim().min(1).max(2000),
  })
  .strict();
const schema = z.union([
  statusSchema,
  z
    .object({
      id: z.string().uuid(),
      expectedRevision: z.string().min(1),
      action: z.literal("mute"),
      mutedUntil: z.string().datetime().nullable(),
      reason: z.string().trim().min(1).max(2000),
      evidence: z.string().trim().min(1).max(2000),
    })
    .strict(),
]);
export async function handleAdminConsoleIncidentPost(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const query = parseAdminConsoleQuery(new URL(request.url));
  if (!query.ok) return query.result;
  const opened = await openAdminConsole(request, deps, {
    mutate: true,
    requiredTables: HANDLER_TABLES.incidentCommands,
  });
  if (!opened.ok) return opened.result;
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return adminClientError(400, "BAD_REQUEST", "Revision, reason and evidence required.");
    const body = parsed.data;
    return await opened.runtime.db.transaction(async (tx) => {
      const rows = await tx.execute(sql`SELECT * FROM trader_admin_incident
        WHERE id = ${body.id}::uuid AND (${query.query.organization_id ?? null}::uuid IS NULL OR EXISTS (
          SELECT 1 FROM trader_admin_diagnostic_event d WHERE d.environment = trader_admin_incident.environment
          AND d.service = trader_admin_incident.service AND d.fingerprint = trader_admin_incident.fingerprint
          AND d.organization_id = ${query.query.organization_id ?? null}::uuid
          AND (${query.query.exchange_account_id ?? null}::text IS NULL OR d.exchange_account_id = ${query.query.exchange_account_id ?? null})
        )) FOR UPDATE`);
      if (!rows[0]) return adminClientError(404, "NOT_FOUND", "Incident not found in scope.");
      const current = presentIncident(rows[0]);
      if (current.revision !== body.expectedRevision) return staleRevisionResult(current);
      const mute = "action" in body;
      if (mute && body.mutedUntil && Date.parse(body.mutedUntil) <= Date.now())
        return adminClientError(400, "BAD_REQUEST", "Mute expiry must be in the future.");
      const targetStatus = mute ? current.status : body.status;
      const transition = mute
        ? { ok: true }
        : nextIncidentStatus(current.status as IncidentStatus, targetStatus as IncidentStatus);
      if (!transition.ok)
        return adminClientError(409, "ILLEGAL_TRANSITION", "Incident transition is not allowed.");
      const next = mute
        ? await tx.execute(sql`UPDATE trader_admin_incident SET muted_until=${body.mutedUntil}::timestamptz,state_version=state_version+1
          WHERE id=${body.id}::uuid AND state_version=${current.stateVersion} RETURNING *`)
        : await tx.execute(sql`UPDATE trader_admin_incident SET status = ${targetStatus}, state_version = state_version + 1,
        resolved_at = CASE WHEN ${targetStatus} = 'resolved' THEN now() ELSE NULL END
        WHERE id = ${body.id}::uuid AND state_version = ${current.stateVersion} RETURNING *`);
      if (!next[0]) return staleRevisionResult(current);
      await tx.insert(traderAdminIncidentEvent).values({
        id: crypto.randomUUID(),
        incidentId: body.id,
        fromStatus: current.status,
        toStatus: targetStatus,
        actorUserId: opened.userId,
        reason: mute ? `${body.mutedUntil ? "MUTE" : "UNMUTE"}: ${body.reason}` : body.reason,
        evidence: body.evidence,
        createdAt: new Date(),
      });
      return adminSuccess({ data: presentIncident(next[0]) }, "postgres");
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
