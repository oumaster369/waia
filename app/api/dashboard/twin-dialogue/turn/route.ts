import { NextResponse } from "next/server";

import { getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { resolveTwinDialogueAssistantText } from "@/lib/ai-gateway/twin-dialogue-completion-gateway";
import type { TwinDialogueTurnSubmitApiResponse } from "@/lib/dashboard/twin-dialogue-turn-api.types";
import { TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE } from "@/lib/dashboard/twin-dialogue-stub";
import {
  emitWaiaRuntimeRouteTelemetry,
  isWaiaConfigError,
  safeTelemetryErrorClass,
} from "@/lib/observability/waia-runtime-route-telemetry";
import { resolveTwinPersistence } from "@/lib/persistence/runtime";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_CHARS = 16_384;

type SubmitBodyJson = {
  message?: unknown;
  idempotencyKey?: unknown;
};

function validationErrorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } };
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
  const telemetryStart = Date.now();
  try {
    const runtime = await getWaiaRuntimeDb();
    resolvedRuntime = runtime;

    const { text: assistantContent, telemetry: gatewayTelemetry } =
      await resolveTwinDialogueAssistantText({
        userContent: trimmed,
      });

    let twinProfileId: string;
    let persisted: {
      userTurn: { id: string; sequence: number; createdAt: Date; content: string };
      assistantTurn: { id: string; sequence: number; createdAt: Date; content: string } | null;
    };
    let userTurnCount: number;

    if (runtime.kind === "sqlite") {
      const p = resolveTwinPersistence(runtime);
      twinProfileId = p.ensureUserTwinSeed(userId);
      persisted = await p.persistUserTwinExchangeWithAssistantStub({
        twinProfileId,
        userContent: trimmed,
        userIdempotencyKey: idempotencyKey ?? null,
        assistantContent,
      });
      userTurnCount = await p.countUserDialogueTurns(twinProfileId);
    } else {
      const p = resolveTwinPersistence(runtime);
      twinProfileId = await p.ensureUserTwinSeed(userId);
      persisted = await p.persistUserTwinExchangeWithAssistantStub({
        twinProfileId,
        userContent: trimmed,
        userIdempotencyKey: idempotencyKey ?? null,
        assistantContent,
      });
      userTurnCount = await p.countUserDialogueTurns(twinProfileId);
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

    emitWaiaRuntimeRouteTelemetry({
      event: "waia_runtime_route",
      route: "twin_dialogue_turn",
      waia_db_backend: runtime.kind,
      http_status: 200,
      outcome: "success",
      duration_ms: Date.now() - telemetryStart,
      ai_gateway_foundation:
        gatewayTelemetry.foundation === "off" ? "off" : "fake_stub",
      ...(gatewayTelemetry.foundation === "fake_stub"
        ? {
            ai_gateway_provider_phase_ms: gatewayTelemetry.provider_phase_ms,
            ...(gatewayTelemetry.degraded ? { ai_gateway_degraded: true as const } : {}),
          }
        : {}),
    });

    return NextResponse.json(body, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    const outcome =
      !resolvedRuntime && isWaiaConfigError(err) ? "config_error" : "internal_error";
    emitWaiaRuntimeRouteTelemetry({
      event: "waia_runtime_route",
      route: "twin_dialogue_turn",
      waia_db_backend: resolvedRuntime?.kind,
      http_status: 500,
      outcome,
      duration_ms: Date.now() - telemetryStart,
      error_class: safeTelemetryErrorClass(err),
    });
    return NextResponse.json(
      validationErrorEnvelope("INTERNAL_ERROR", "Something went wrong."),
      { status: 500 },
    );
  }
}
