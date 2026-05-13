import { NextResponse } from "next/server";

import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import {
  resolveTwinDialogueAssistantText,
  type TwinDialogueGatewayFoundationTelemetry,
} from "@/lib/ai-gateway/twin-dialogue-completion-gateway";
import type { TwinDialogueTurnSubmitApiResponse } from "@/lib/dashboard/twin-dialogue-turn-api.types";
import { TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE } from "@/lib/dashboard/twin-dialogue-stub";
import { isReadinessWriterEnabled } from "@/lib/readiness/readiness-writer-config";
import {
  attachPostgresLifecycleToTelemetry,
  emitWaiaRuntimeRouteTelemetry,
  isWaiaConfigError,
  safeTelemetryErrorClass,
  type WaiaRuntimeRouteTelemetryPayload,
} from "@/lib/observability/waia-runtime-route-telemetry";
import { resolveTwinPersistence } from "@/lib/persistence/runtime";
import type { PostgresTwinPersistence } from "@/lib/persistence/postgres/twin-persistence";
import type { SqliteTwinPersistence } from "@/lib/persistence/sqlite/twin-persistence";
import type { PersistUserTwinExchangeWithAssistantResult } from "@/lib/twin-persistence/loader";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_CHARS = 16_384;

/** Content-free telemetry outcome for readiness demo writer (`twin_dialogue_turn`). */
type ReadinessWriterTelemetryOutcome =
  | "disabled"
  | "replay_skipped"
  | "skipped"
  | "applied"
  | "noop"
  | "error";

type SubmitBodyJson = {
  message?: unknown;
  idempotencyKey?: unknown;
};

function validationErrorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } };
}

/** Maps gateway usage / request id into stdout telemetry fields (content-free, DEE-79). */
function aiGatewayProviderTelemetryExtras(
  gatewayTelemetry: TwinDialogueGatewayFoundationTelemetry,
): Partial<
  Pick<
    WaiaRuntimeRouteTelemetryPayload,
    | "ai_gateway_provider_prompt_tokens"
    | "ai_gateway_provider_completion_tokens"
    | "ai_gateway_provider_total_tokens"
    | "ai_gateway_provider_request_id"
  >
> {
  if (gatewayTelemetry.foundation === "off") {
    return {};
  }
  const out: Partial<
    Pick<
      WaiaRuntimeRouteTelemetryPayload,
      | "ai_gateway_provider_prompt_tokens"
      | "ai_gateway_provider_completion_tokens"
      | "ai_gateway_provider_total_tokens"
      | "ai_gateway_provider_request_id"
    >
  > = {};
  const u = gatewayTelemetry.usage;
  if (u?.promptTokens !== undefined && Number.isFinite(u.promptTokens)) {
    out.ai_gateway_provider_prompt_tokens = u.promptTokens;
  }
  if (u?.completionTokens !== undefined && Number.isFinite(u.completionTokens)) {
    out.ai_gateway_provider_completion_tokens = u.completionTokens;
  }
  if (u?.totalTokens !== undefined && Number.isFinite(u.totalTokens)) {
    out.ai_gateway_provider_total_tokens = u.totalTokens;
  }
  if (
    gatewayTelemetry.providerRequestId !== undefined &&
    gatewayTelemetry.providerRequestId !== ""
  ) {
    out.ai_gateway_provider_request_id = gatewayTelemetry.providerRequestId;
  }
  return out;
}

/** POST /api/dashboard/twin-dialogue/turn — persist one user-role Twin dialogue turn (DEE-39). */
export async function POST(request: Request) {
  const userId = await getOptionalSessionUserId();
  if (!userId) {
    return NextResponse.json(
      validationErrorEnvelope("UNAUTHORIZED", "Session required."),
      { status: 401 },
    );
  }

  let parsed: SubmitBodyJson;
  try {
    parsed = (await request.json()) as SubmitBodyJson;
  } catch {
    return NextResponse.json(
      validationErrorEnvelope("INVALID_BODY", "Expected JSON body."),
      { status: 400 },
    );
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json(
      validationErrorEnvelope("INVALID_BODY", "Request body must be a JSON object."),
      { status: 400 },
    );
  }

  const rawMessage = parsed.message;
  if (typeof rawMessage !== "string") {
    return NextResponse.json(
      validationErrorEnvelope("INVALID_BODY", "message must be a string."),
      { status: 400 },
    );
  }

  const trimmed = rawMessage.trim();
  if (trimmed.length === 0) {
    return NextResponse.json(
      validationErrorEnvelope("EMPTY_MESSAGE", "message must not be empty or whitespace."),
      { status: 400 },
    );
  }

  if (trimmed.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      validationErrorEnvelope(
        "MESSAGE_TOO_LONG",
        `message must not exceed ${MAX_MESSAGE_CHARS} characters.`,
      ),
      { status: 400 },
    );
  }

  let idempotencyKey: string | null | undefined;
  const rawKey = parsed.idempotencyKey;
  if (rawKey !== undefined && rawKey !== null) {
    if (typeof rawKey !== "string") {
      return NextResponse.json(
        validationErrorEnvelope("INVALID_BODY", "idempotencyKey must be a string when provided."),
        { status: 400 },
      );
    }
    const trimmedKey = rawKey.trim();
    idempotencyKey = trimmedKey.length > 0 ? trimmedKey : null;
  }

  let resolvedRuntime: WaiaRuntimeDb | undefined;
  let telemetryPayload: WaiaRuntimeRouteTelemetryPayload | undefined;
  const telemetryStart = Date.now();
  try {
    const runtime = await getWaiaRuntimeDb();
    resolvedRuntime = runtime;

    const { text: assistantContent, telemetry: gatewayTelemetry } =
      await resolveTwinDialogueAssistantText({
        userContent: trimmed,
        signal: request.signal,
      });

    let twinProfileId: string;
    let persisted: PersistUserTwinExchangeWithAssistantResult;
    let userTurnCount: number;

    let twinPersistence: SqliteTwinPersistence | PostgresTwinPersistence;

    if (runtime.kind === "sqlite") {
      twinPersistence = resolveTwinPersistence(runtime);
      twinProfileId = twinPersistence.ensureUserTwinSeed(userId);
      persisted = await twinPersistence.persistUserTwinExchangeWithAssistantStub({
        twinProfileId,
        userContent: trimmed,
        userIdempotencyKey: idempotencyKey ?? null,
        assistantContent,
      });
      userTurnCount = await twinPersistence.countUserDialogueTurns(twinProfileId);
    } else {
      twinPersistence = resolveTwinPersistence(runtime);
      twinProfileId = await twinPersistence.ensureUserTwinSeed(userId);
      persisted = await twinPersistence.persistUserTwinExchangeWithAssistantStub({
        twinProfileId,
        userContent: trimmed,
        userIdempotencyKey: idempotencyKey ?? null,
        assistantContent,
      });
      userTurnCount = await twinPersistence.countUserDialogueTurns(twinProfileId);
    }

    let readiness_writer_invoked = false;
    let readiness_writer_outcome: ReadinessWriterTelemetryOutcome = "disabled";

    const writerOptIn = isReadinessWriterEnabled();
    if (!writerOptIn) {
      readiness_writer_outcome = "disabled";
    } else if (persisted.userTurn.replayed) {
      readiness_writer_outcome = "replay_skipped";
    } else {
      readiness_writer_invoked = true;
      try {
        const adv = await twinPersistence.applyReadinessDemoAdvanceForSubstantiveTurn({
          twinProfileId,
          userMessage: trimmed,
        });
        readiness_writer_outcome =
          adv.status === "applied"
            ? "applied"
            : adv.status === "noop"
              ? "noop"
              : "skipped";
      } catch {
        readiness_writer_outcome = "error";
      }
    }

    const twinSignals = {
      hasMeaningfulExchange: userTurnCount > 0,
    };

    const at = persisted.assistantTurn;

    const body: TwinDialogueTurnSubmitApiResponse = {
      userTurn: {
        id: persisted.userTurn.id,
        sequence: persisted.userTurn.sequence,
        role: "user",
        content: persisted.userTurn.content,
        createdAt: persisted.userTurn.createdAt.toISOString(),
      },
      assistantTurn:
        at != null
          ? {
              id: at.id,
              sequence: at.sequence,
              role: "assistant",
              content: at.content,
              createdAt: at.createdAt.toISOString(),
            }
          : null,
      twinSignals,
      assistantPlaceholder: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
    };

    telemetryPayload = {
      event: "waia_runtime_route",
      route: "twin_dialogue_turn",
      waia_db_backend: runtime.kind,
      http_status: 200,
      outcome: "success",
      duration_ms: Date.now() - telemetryStart,
      ...(gatewayTelemetry.foundation === "off"
        ? { ai_gateway_foundation: "off" as const }
        : {
            ai_gateway_foundation: gatewayTelemetry.foundation,
            ai_gateway_provider: gatewayTelemetry.providerId,
            ai_gateway_provider_outcome: gatewayTelemetry.providerOutcome,
            ai_gateway_provider_phase_ms: gatewayTelemetry.provider_phase_ms,
            ...(gatewayTelemetry.degraded ? { ai_gateway_degraded: true as const } : {}),
            ...aiGatewayProviderTelemetryExtras(gatewayTelemetry),
          }),
      readiness_writer_invoked,
      readiness_writer_outcome,
    };

    return NextResponse.json(body, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    const outcome =
      !resolvedRuntime && isWaiaConfigError(err) ? "config_error" : "internal_error";
    telemetryPayload = {
      event: "waia_runtime_route",
      route: "twin_dialogue_turn",
      waia_db_backend: resolvedRuntime?.kind,
      http_status: 500,
      outcome,
      duration_ms: Date.now() - telemetryStart,
      error_class: safeTelemetryErrorClass(err),
    };
    return NextResponse.json(
      validationErrorEnvelope("INTERNAL_ERROR", "Something went wrong."),
      { status: 500 },
    );
  } finally {
    const pgClose = await disposeWaiaRuntimeDb(resolvedRuntime);
    if (telemetryPayload) {
      attachPostgresLifecycleToTelemetry(telemetryPayload, resolvedRuntime, pgClose);
      emitWaiaRuntimeRouteTelemetry(telemetryPayload);
    }
  }
}
