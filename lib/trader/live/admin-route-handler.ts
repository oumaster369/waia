import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import {
  serializeOrgLiveEnableEvent,
  serializeOrgLiveEnablePreview,
  serializeOrgLiveEnableView,
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
import { REQUIRED_ORG_LIVE_ENABLE_ACK } from "@/lib/trader/live/config";
import {
  createPostgresOrgLiveEnableService,
  createSqliteOrgLiveEnableService,
} from "@/lib/trader/live/org-live-enable-service";
import { listOrgLiveEnableEventsPostgres } from "@/lib/trader/live/repository-postgres";
import { listOrgLiveEnableEventsSqlite } from "@/lib/trader/live/repository-sqlite";
import type { RequestOrgLiveEnableInput } from "@/lib/trader/live/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

function createOrgLiveEnableService(
  runtime: Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>,
) {
  if (runtime.kind === "sqlite") {
    return createSqliteOrgLiveEnableService(runtime.db);
  }
  return createPostgresOrgLiveEnableService(runtime.db);
}

export async function handleAdminOrgLiveEnableGet(
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
    const service = createOrgLiveEnableService(runtime);
    const view = url.searchParams.get("view")?.trim() ?? "state";

    if (view === "events") {
      const events =
        runtime.kind === "sqlite"
          ? listOrgLiveEnableEventsSqlite(runtime.db, context)
          : await listOrgLiveEnableEventsPostgres(runtime.db, context);
      return adminSuccess({ events: events.map(serializeOrgLiveEnableEvent) }, runtime.kind);
    }

    if (view === "preview") {
      const preview = await service.preview(context);
      return adminSuccess({ preview: serializeOrgLiveEnablePreview(preview) }, runtime.kind);
    }

    const state = await service.getState(context);
    return adminSuccess({ state: state ? serializeOrgLiveEnableView(state) : null }, runtime.kind);
  } catch (err) {
    return mapServiceError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}

type OrgLiveEnableCommandBody = {
  command?: string;
  organization_id?: string;
  expected_state_version?: number;
  reason?: string;
  ack_phrase?: string;
  max_notional_cap?: string;
};

function parseCommandBody(raw: unknown): OrgLiveEnableCommandBody | AdminRouteHandlerResult {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return adminClientError(400, "INVALID_BODY", "Request body must be a JSON object.");
  }
  return raw as OrgLiveEnableCommandBody;
}

export async function handleAdminOrgLiveEnableCommandPost(
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

  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, organizationId, "admin.audit.read");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;

    const context = requireOrgContext(organizationId);
    const actor = adminActor(auth.userId);
    const service = createOrgLiveEnableService(runtime);
    const transitionInput = {
      expectedStateVersion: body.expected_state_version ?? 0,
      reason: body.reason?.trim() || null,
    };

    if (command === "request") {
      const maxNotionalCap = body.max_notional_cap?.trim();
      if (!maxNotionalCap) {
        return adminClientError(
          400,
          "MAX_NOTIONAL_CAP_REQUIRED",
          "max_notional_cap is required for request.",
        );
      }
      const input: RequestOrgLiveEnableInput = { maxNotionalCap };
      const state = await service.requestEnable(actor, context, input);
      return adminSuccess({ state: serializeOrgLiveEnableView(state) }, runtime.kind);
    }

    if (
      body.expected_state_version === undefined ||
      !Number.isInteger(body.expected_state_version)
    ) {
      return adminClientError(
        400,
        "EXPECTED_STATE_VERSION_REQUIRED",
        "expected_state_version is required.",
      );
    }

    if (command === "confirm") {
      const ackPhrase = body.ack_phrase?.trim();
      if (ackPhrase !== REQUIRED_ORG_LIVE_ENABLE_ACK) {
        return adminClientError(400, "ACK_PHRASE_REQUIRED", "Valid ack_phrase is required.");
      }
      const state = await service.confirmEnable(actor, context, {
        ...transitionInput,
        ackPhrase,
      });
      return adminSuccess({ state: serializeOrgLiveEnableView(state) }, runtime.kind);
    }

    if (command === "mark-enabled") {
      const state = await service.markEnabled(actor, context, transitionInput);
      return adminSuccess({ state: serializeOrgLiveEnableView(state) }, runtime.kind);
    }

    if (command === "disable") {
      const state = await service.disable(actor, context, transitionInput);
      return adminSuccess({ state: serializeOrgLiveEnableView(state) }, runtime.kind);
    }

    if (command === "cancel") {
      const state = await service.cancel(actor, context, transitionInput);
      return adminSuccess({ state: serializeOrgLiveEnableView(state) }, runtime.kind);
    }

    return adminClientError(400, "UNKNOWN_COMMAND", `Unknown command: ${command}`);
  } catch (err) {
    return mapServiceError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}
