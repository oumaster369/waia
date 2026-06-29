import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { KillSwitchType } from "@/db/schema";
import { killSwitchTypeEnum } from "@/db/schema";
import {
  serializeEffectiveKillSwitchState,
  serializeKillSwitchTransitionResult,
  serializeKillSwitchView,
  serializeRecoveryPreview,
} from "@/lib/trader/admin-serialize";
import {
  adminActor,
  adminClientError,
  adminSuccess,
  authorizeAdminRoute,
  mapServiceError,
  parseOrganizationId,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import {
  createPostgresGovernedRecoveryService,
  createSqliteGovernedRecoveryService,
} from "@/lib/trader/risk/kill-switch/governed-recovery";
import {
  createPostgresKillSwitchService,
  createSqliteKillSwitchService,
} from "@/lib/trader/risk/kill-switch/kill-switch-service";
import type {
  EscalateKillSwitchInput,
  KillSwitchScopeKey,
  KillSwitchTarget,
  TripKillSwitchInput,
} from "@/lib/trader/risk/kill-switch/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

function parseSwitchType(url: URL): KillSwitchType | AdminRouteHandlerResult {
  const raw = url.searchParams.get("switch_type")?.trim();
  if (!raw) {
    return adminClientError(400, "SWITCH_TYPE_REQUIRED", "switch_type query param required.");
  }
  if (!(killSwitchTypeEnum as readonly string[]).includes(raw)) {
    return adminClientError(400, "SWITCH_TYPE_INVALID", "switch_type is invalid.");
  }
  return raw as KillSwitchType;
}

function orgKillSwitchTarget(organizationId: string): KillSwitchTarget {
  return { scopeType: "organization", organizationId };
}

function orgKillSwitchKey(switchType: KillSwitchType): KillSwitchScopeKey {
  return { scopeType: "organization", scopeRef: null, switchType };
}

function createKillSwitchService(
  runtime: Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>,
) {
  if (runtime.kind === "sqlite") {
    return createSqliteKillSwitchService(runtime.db);
  }
  return createPostgresKillSwitchService(runtime.db);
}

function createRecoveryService(
  runtime: Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>,
) {
  if (runtime.kind === "sqlite") {
    return createSqliteGovernedRecoveryService(runtime.db);
  }
  return createPostgresGovernedRecoveryService(runtime.db);
}

export async function handleAdminKillSwitchesGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const orgParsed = parseOrganizationId(url);
  if (typeof orgParsed !== "string") {
    return orgParsed;
  }

  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, orgParsed, "admin.audit.read");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;
    const context = requireOrgContext(orgParsed);
    const service = createKillSwitchService(runtime);

    const switchTypeParam = url.searchParams.get("switch_type")?.trim();
    const previewRecovery = url.searchParams.get("preview") === "recovery";

    if (switchTypeParam) {
      const switchType = parseSwitchType(url);
      if (typeof switchType !== "string") {
        return switchType;
      }
      const target = orgKillSwitchTarget(orgParsed);
      const key = orgKillSwitchKey(switchType);

      if (previewRecovery) {
        const recovery = createRecoveryService(runtime);
        const preview = await recovery.previewRecovery(context, target, key);
        return adminSuccess({ preview: serializeRecoveryPreview(preview) }, runtime.kind);
      }

      const row = await service.get(context, target, key);
      if (!row) {
        return adminClientError(404, "KILL_SWITCH_NOT_FOUND", "Kill switch not found.");
      }
      return adminSuccess({ killSwitch: serializeKillSwitchView(row) }, runtime.kind);
    }

    const [rows, effective] = await Promise.all([
      service.list(context),
      service.getEffectiveState(context),
    ]);
    return adminSuccess(
      {
        killSwitches: rows.map(serializeKillSwitchView),
        effective: serializeEffectiveKillSwitchState(effective),
      },
      runtime.kind,
    );
  } catch (err) {
    return mapServiceError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}

type KillSwitchCommandBody = {
  command?: string;
  organization_id?: string;
  switch_type?: string;
  expected_state_version?: number;
  enforcement_mode?: TripKillSwitchInput["enforcementMode"];
  origin?: TripKillSwitchInput["origin"];
  reason?: string;
  cooling_off_ms?: number;
};

function parseCommandBody(raw: unknown): KillSwitchCommandBody | AdminRouteHandlerResult {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return adminClientError(400, "INVALID_BODY", "Request body must be a JSON object.");
  }
  return raw as KillSwitchCommandBody;
}

export async function handleAdminKillSwitchCommandPost(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return adminClientError(400, "INVALID_BODY", "Expected JSON body.");
  }

  const bodyOrError = parseCommandBody(parsed);
  if ("status" in bodyOrError) {
    return bodyOrError;
  }
  const body = bodyOrError;

  const organizationId = body.organization_id?.trim();
  if (!organizationId) {
    return adminClientError(400, "ORGANIZATION_ID_REQUIRED", "organization_id is required.");
  }
  try {
    requireOrgContext(organizationId);
  } catch {
    return adminClientError(400, "ORGANIZATION_ID_INVALID", "organization_id is invalid.");
  }

  const command = body.command?.trim();
  if (!command) {
    return adminClientError(400, "COMMAND_REQUIRED", "command is required.");
  }

  const switchTypeRaw = body.switch_type?.trim();
  if (!switchTypeRaw || !(killSwitchTypeEnum as readonly string[]).includes(switchTypeRaw)) {
    return adminClientError(400, "SWITCH_TYPE_INVALID", "switch_type is invalid.");
  }
  const switchType = switchTypeRaw as KillSwitchType;

  if (body.expected_state_version === undefined || !Number.isInteger(body.expected_state_version)) {
    return adminClientError(
      400,
      "EXPECTED_STATE_VERSION_REQUIRED",
      "expected_state_version is required.",
    );
  }

  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, organizationId, "admin.audit.read");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;

    const context = requireOrgContext(organizationId);
    const actor = adminActor(auth.userId);
    const target = orgKillSwitchTarget(organizationId);
    const key = orgKillSwitchKey(switchType);
    const expectedStateVersion = body.expected_state_version;
    const reason = body.reason?.trim() || undefined;

    if (command === "trip") {
      if (!body.enforcement_mode || !body.origin) {
        return adminClientError(
          400,
          "TRIP_INPUT_INVALID",
          "enforcement_mode and origin are required for trip.",
        );
      }
      const service = createKillSwitchService(runtime);
      const result = await service.trip(actor, context, target, key, {
        enforcementMode: body.enforcement_mode,
        origin: body.origin,
        reason,
        coolingOffMs: body.cooling_off_ms ?? null,
        expectedStateVersion,
      });
      return adminSuccess({ result: serializeKillSwitchTransitionResult(result) }, runtime.kind);
    }

    if (command === "escalate") {
      if (!body.enforcement_mode) {
        return adminClientError(
          400,
          "ESCALATE_INPUT_INVALID",
          "enforcement_mode is required for escalate.",
        );
      }
      const service = createKillSwitchService(runtime);
      const input: EscalateKillSwitchInput = {
        enforcementMode: body.enforcement_mode,
        reason,
        expectedStateVersion,
      };
      const result = await service.escalate(actor, context, target, key, input);
      return adminSuccess({ result: serializeKillSwitchTransitionResult(result) }, runtime.kind);
    }

    const recovery = createRecoveryService(runtime);
    const transitionInput = { expectedStateVersion, reason };

    if (command === "request-clear") {
      const result = await recovery.requestClear(actor, context, target, key, {
        ...transitionInput,
        coolingOffMs: body.cooling_off_ms,
      });
      return adminSuccess({ result: serializeKillSwitchTransitionResult(result) }, runtime.kind);
    }

    if (command === "cancel-clear") {
      const result = await recovery.cancelClear(actor, context, target, key, transitionInput);
      return adminSuccess({ result: serializeKillSwitchTransitionResult(result) }, runtime.kind);
    }

    if (command === "confirm-clear") {
      const result = await recovery.confirmClear(actor, context, target, key, transitionInput);
      return adminSuccess({ result: serializeKillSwitchTransitionResult(result) }, runtime.kind);
    }

    return adminClientError(400, "UNKNOWN_COMMAND", `Unknown command: ${command}`);
  } catch (err) {
    return mapServiceError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}
