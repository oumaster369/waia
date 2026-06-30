import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { serializePromotionPreview, serializePromotionRecord } from "@/lib/trader/admin-serialize";
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
import { OperatorEvidenceError } from "@/lib/trader/validation-gate/operator-evidence";
import {
  assertEffectiveAck,
  OperatorRunwayInputError,
  parseAdminPromotionRequestAssembly,
} from "@/lib/trader/validation-gate/operator-promotion-inputs";
import {
  createPostgresStrategyPromotionRepository,
  createPostgresStrategyPromotionService,
  createSqliteStrategyPromotionRepository,
  createSqliteStrategyPromotionService,
} from "@/lib/trader/validation-gate/promotion-service";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

function createPromotionService(
  runtime: Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>,
) {
  if (runtime.kind === "sqlite") {
    return createSqliteStrategyPromotionService(runtime.db);
  }
  return createPostgresStrategyPromotionService(runtime.db);
}

function createPromotionRepository(
  runtime: Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>,
) {
  if (runtime.kind === "sqlite") {
    return createSqliteStrategyPromotionRepository(runtime.db);
  }
  return createPostgresStrategyPromotionRepository(runtime.db);
}

export async function handleAdminStrategyPromotionsGet(
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
    const service = createPromotionService(runtime);
    const repository = createPromotionRepository(runtime);

    const strategyId = url.searchParams.get("strategy_id")?.trim();
    const recordId = url.searchParams.get("record_id")?.trim();
    const view = url.searchParams.get("view")?.trim();

    if (recordId) {
      if (view === "preview") {
        const preview = await service.previewPromotion(context, recordId);
        return adminSuccess({ preview: serializePromotionPreview(preview) }, runtime.kind);
      }
      const record = await repository.getById(context, recordId);
      if (!record) {
        return adminClientError(404, "PROMOTION_NOT_FOUND", "Promotion record not found.");
      }
      return adminSuccess({ record: serializePromotionRecord(record) }, runtime.kind);
    }

    if (!strategyId) {
      return adminClientError(
        400,
        "STRATEGY_OR_RECORD_REQUIRED",
        "strategy_id or record_id query param required.",
      );
    }

    const effective = await service.getEffectivePromotion(context, strategyId);
    return adminSuccess(
      { effective: effective ? serializePromotionRecord(effective) : null },
      runtime.kind,
    );
  } catch (err) {
    return mapServiceError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}

type StrategyPromotionCommandBody = {
  command?: string;
  organization_id?: string;
  record_id?: string;
  strategy_id?: string;
  expected_state_version?: number;
  cooling_off_ms?: number;
  reason?: string;
  ack?: string;
  idempotency_key?: string;
  evidence?: unknown;
  inputs?: unknown;
};

function mapPromotionRequestInputError(err: unknown): AdminRouteHandlerResult | null {
  if (err instanceof OperatorRunwayInputError || err instanceof OperatorEvidenceError) {
    return adminClientError(400, err.code, err.message);
  }
  return null;
}

function parseCommandBody(raw: unknown): StrategyPromotionCommandBody | AdminRouteHandlerResult {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return adminClientError(400, "INVALID_BODY", "Request body must be a JSON object.");
  }
  return raw as StrategyPromotionCommandBody;
}

export async function handleAdminStrategyPromotionCommandPost(
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
    const service = createPromotionService(runtime);

    if (command === "request") {
      const strategyId = body.strategy_id?.trim();
      if (!strategyId) {
        return adminClientError(400, "STRATEGY_ID_REQUIRED", "strategy_id is required.");
      }

      let assembly;
      try {
        assembly = parseAdminPromotionRequestAssembly({
          organizationId,
          strategyId,
          evidence: body.evidence,
          inputs: body.inputs,
        });
      } catch (err) {
        const mapped = mapPromotionRequestInputError(err);
        if (mapped) {
          return mapped;
        }
        throw err;
      }

      const idempotencyKey = body.idempotency_key?.trim();
      const record = await service.requestPromotion(actor, context, {
        idempotencyKey: idempotencyKey && idempotencyKey.length > 0 ? idempotencyKey : undefined,
        assembly,
      });
      return adminSuccess({ record: serializePromotionRecord(record) }, runtime.kind);
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

    const transitionInput = {
      expectedStateVersion: body.expected_state_version,
      coolingOffMs: body.cooling_off_ms,
      reason: body.reason?.trim(),
    };

    if (command === "confirm") {
      const recordId = body.record_id?.trim();
      if (!recordId) {
        return adminClientError(400, "RECORD_ID_REQUIRED", "record_id is required.");
      }
      const record = await service.confirmPromotion(actor, context, recordId, transitionInput);
      return adminSuccess({ record: serializePromotionRecord(record) }, runtime.kind);
    }

    if (command === "mark-effective") {
      try {
        assertEffectiveAck(body.ack);
      } catch (err) {
        return mapServiceError(err);
      }
      const recordId = body.record_id?.trim();
      if (!recordId) {
        return adminClientError(400, "RECORD_ID_REQUIRED", "record_id is required.");
      }
      const record = await service.markEffective(actor, context, recordId, transitionInput);
      return adminSuccess({ record: serializePromotionRecord(record) }, runtime.kind);
    }

    if (command === "cancel") {
      const recordId = body.record_id?.trim();
      if (!recordId) {
        return adminClientError(400, "RECORD_ID_REQUIRED", "record_id is required.");
      }
      const record = await service.cancelPromotion(actor, context, recordId, transitionInput);
      return adminSuccess({ record: serializePromotionRecord(record) }, runtime.kind);
    }

    if (command === "demote") {
      const strategyId = body.strategy_id?.trim();
      if (!strategyId) {
        return adminClientError(400, "STRATEGY_ID_REQUIRED", "strategy_id is required.");
      }
      const record = await service.demoteStrategy(actor, context, strategyId, transitionInput);
      return adminSuccess({ record: serializePromotionRecord(record) }, runtime.kind);
    }

    return adminClientError(400, "UNKNOWN_COMMAND", `Unknown command: ${command}`);
  } catch (err) {
    return mapServiceError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}
