import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  adminActor,
  adminClientError,
  adminSuccess,
  mapServiceError,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { staleRevisionResult } from "@/lib/trader/admin-console/auth";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import {
  withAdminRouteSnapshot,
  type AdminReadTx,
} from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { adminRevision } from "@/lib/trader/admin-console/revision";
import { createPostgresKillSwitchService } from "@/lib/trader/risk/kill-switch/kill-switch-service";
import { KillSwitchConcurrencyError } from "@/lib/trader/risk/kill-switch/errors";
import type { KillSwitchScopeKey, KillSwitchTarget } from "@/lib/trader/risk/kill-switch/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const targetSchema = z
  .object({
    scope: z.enum(["platform", "organization"]),
    organization_id: z.string().uuid().optional(),
    switch_type: z.enum(["PAUSE", "CLOSE_ONLY", "EMERGENCY_STOP"]),
  })
  .strict()
  .refine((body) =>
    body.scope === "organization" ? Boolean(body.organization_id) : !body.organization_id,
  );
const commandSchema = z
  .object({
    target: targetSchema,
    command: z.literal("trip"),
    expectedRevision: z.string().min(1),
    expectedStateVersion: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).max(2000),
    confirmed: z.literal(true),
  })
  .strict();
type TargetInput = z.infer<typeof targetSchema>;
function targetOf(input: TargetInput): KillSwitchTarget {
  return input.scope === "platform"
    ? { scopeType: "platform" }
    : { scopeType: "organization", organizationId: input.organization_id! };
}
function keyOf(input: TargetInput): KillSwitchScopeKey {
  return { scopeType: input.scope, scopeRef: null, switchType: input.switch_type };
}
async function readControl(tx: AdminReadTx, input: TargetInput, lock = false) {
  const rows = await tx.execute(sql`
    SELECT id::text, state, state_version, enforcement_mode, reason, updated_at
    FROM trader_kill_switches
    WHERE scope_type = ${input.scope} AND scope_ref = '' AND switch_type = ${input.switch_type}
      AND organization_id IS NOT DISTINCT FROM ${input.organization_id ?? null}::uuid
    ${lock ? sql`FOR UPDATE` : sql``}
  `);
  const row = rows[0];
  return {
    target: input,
    expectedStateVersion: row ? Number(row.state_version) : 0,
    state: row ? String(row.state) : "NOT_CREATED",
    id: row ? String(row.id) : null,
    enforcementMode: row ? String(row.enforcement_mode) : null,
    reason: row ? String(row.reason) : null,
    updatedAt:
      row?.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row?.updated_at
          ? new Date(String(row.updated_at)).toISOString()
          : null,
    requestedEnforcement: input.switch_type === "EMERGENCY_STOP" ? "STOP_ACCOUNT" : "CLOSE_ONLY",
  };
}
export async function handleAdminConsoleKillSwitchGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = targetSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success)
    return adminClientError(
      400,
      "KILL_SWITCH_SCOPE_UNSUPPORTED",
      "Only explicit platform or organization targets are supported.",
    );
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.killSwitch,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) =>
      adminSuccess(
        adminEnvelope({
          scope:
            parsed.data.scope === "platform"
              ? { kind: "fleet" }
              : { kind: "organization", organizationId: parsed.data.organization_id },
          data: await readControl(tx, parsed.data),
        }),
        "postgres",
      ),
    );
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
export async function handleAdminConsoleKillSwitchPost(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const opened = await openAdminConsole(request, deps, {
    mutate: true,
    requiredTables: HANDLER_TABLES.killSwitch,
  });
  if (!opened.ok) return opened.result;
  try {
    const parsed = commandSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return adminClientError(
        400,
        "BAD_REQUEST",
        "Explicit target, read revision and manual confirmation required.",
      );
    const body = parsed.data;
    return await opened.runtime.db.transaction(async (tx) => {
      // Serialize console commands, including two first writes. Existing rows also lock against legacy writers.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`admin-kill:${body.target.scope}:${body.target.organization_id ?? ""}:${body.target.switch_type}`}, 0))`,
      );
      const current = await readControl(tx, body.target, true);
      const revision = adminRevision(current);
      if (
        revision !== body.expectedRevision ||
        current.expectedStateVersion !== body.expectedStateVersion
      )
        return staleRevisionResult({ revision, data: current });
      if (current.state === "ACTIVE")
        return adminClientError(
          409,
          "KILL_SWITCH_ALREADY_ACTIVE",
          "The switch is already active. Read the current state.",
        );
      const service = createPostgresKillSwitchService(tx);
      const result = await service.trip(
        adminActor(opened.userId),
        body.target.scope === "organization"
          ? requireOrgContext(body.target.organization_id!)
          : null,
        targetOf(body.target),
        keyOf(body.target),
        {
          expectedStateVersion: body.expectedStateVersion,
          origin: "manual",
          reason: body.reason,
          enforcementMode:
            body.target.switch_type === "EMERGENCY_STOP" ? "STOP_ACCOUNT" : "CLOSE_ONLY",
        },
      );
      const data = await readControl(tx, body.target);
      return adminSuccess(
        {
          revision: adminRevision(data),
          data,
          auditId: result.auditId,
          confirmation: "READ_BACK_REQUIRED",
        },
        "postgres",
      );
    });
  } catch (error) {
    if (
      error instanceof KillSwitchConcurrencyError ||
      (error && typeof error === "object" && "code" in error && error.code === "23505")
    )
      return staleRevisionResult({ readBackRequired: true });
    return mapServiceError(error);
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
