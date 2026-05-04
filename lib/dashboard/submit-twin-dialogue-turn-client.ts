import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import type {
  TwinDialogueAssistantSubmittedTurnDto,
  TwinDialogueTurnSubmitApiResponse,
} from "@/lib/dashboard/twin-dialogue-turn-api.types";

export const TWIN_DIALOGUE_TURN_PATH = "/api/dashboard/twin-dialogue/turn";

export type SubmitTwinDialogueTurnOk = {
  kind: "ok";
  body: TwinDialogueTurnSubmitApiResponse;
};

export type SubmitTwinDialogueTurnErr = {
  kind: "err";
  status: number;
  /** Parsed server error.code when available */
  code?: string;
  /** User-visible message (controlled + safe to show) */
  displayMessage: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseAssistantTurn(
  at: unknown,
): TwinDialogueAssistantSubmittedTurnDto | null | "invalid" {
  if (at === null) {
    return null;
  }
  if (!isRecord(at)) {
    return "invalid";
  }
  const rid = at.id;
  const rsequence = at.sequence;
  const rrole = at.role;
  const rcontent = at.content;
  const rcreatedAt = at.createdAt;
  if (
    typeof rid !== "string" ||
    typeof rsequence !== "number" ||
    rrole !== "assistant" ||
    typeof rcontent !== "string" ||
    typeof rcreatedAt !== "string"
  ) {
    return "invalid";
  }
  return {
    id: rid,
    sequence: rsequence,
    role: "assistant",
    content: rcontent,
    createdAt: rcreatedAt,
  };
}

function narrowSuccess(raw: unknown): TwinDialogueTurnSubmitApiResponse | null {
  if (!isRecord(raw)) {
    return null;
  }
  const userTurnRaw = raw.userTurn;
  if (!isRecord(userTurnRaw)) {
    return null;
  }
  const tsRaw = raw.twinSignals;
  const ap = raw.assistantPlaceholder;

  const id = userTurnRaw.id;
  const sequence = userTurnRaw.sequence;
  const role = userTurnRaw.role;
  const content = userTurnRaw.content;
  const createdAt = userTurnRaw.createdAt;

  if (
    typeof id !== "string" ||
    typeof sequence !== "number" ||
    role !== "user" ||
    typeof content !== "string" ||
    typeof createdAt !== "string" ||
    typeof ap !== "string" ||
    !isRecord(tsRaw) ||
    typeof tsRaw.hasMeaningfulExchange !== "boolean"
  ) {
    return null;
  }

  if (!("assistantTurn" in raw)) {
    return null;
  }
  const assistantParsed = parseAssistantTurn(raw.assistantTurn);
  if (assistantParsed === "invalid") {
    return null;
  }

  return {
    userTurn: {
      id,
      sequence,
      role: "user",
      content,
      createdAt,
    },
    assistantTurn: assistantParsed,
    twinSignals: { hasMeaningfulExchange: tsRaw.hasMeaningfulExchange },
    assistantPlaceholder: ap,
  };
}

function parseEnvelope(raw: unknown): ApiErrorEnvelope | null {
  if (!isRecord(raw)) {
    return null;
  }
  const error = raw.error;
  if (!isRecord(error) || typeof error.code !== "string") {
    return null;
  }
  const message = error.message;
  if (message !== undefined && typeof message !== "string") {
    return null;
  }
  return { error: { code: error.code, message } };
}

/** POST Twin dialogue turn; same-origin cookie session included. */
export async function submitTwinDialogueTurnClient(params: {
  message: string;
  idempotencyKey: string;
}): Promise<SubmitTwinDialogueTurnOk | SubmitTwinDialogueTurnErr> {
  let response: Response;
  try {
    response = await fetch(TWIN_DIALOGUE_TURN_PATH, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: params.message,
        idempotencyKey: params.idempotencyKey,
      }),
    });
  } catch {
    return {
      kind: "err",
      status: 0,
      displayMessage: "Could not send your message. Please try again.",
    };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return {
      kind: "err",
      status: response.status,
      displayMessage:
        response.ok || response.status < 400
          ? "Could not read the server response. Please try again."
          : "Could not send your message. Please try again.",
    };
  }

  if (response.ok && response.status === 200) {
    const ok = narrowSuccess(parsed);
    if (!ok) {
      return {
        kind: "err",
        status: response.status,
        displayMessage: "Could not read the server response. Please try again.",
      };
    }
    return { kind: "ok", body: ok };
  }

  const env = parseEnvelope(parsed);
  if (env) {
    const { code, message } = env.error;
    if (code === "UNAUTHORIZED") {
      return {
        kind: "err",
        status: response.status,
        code,
        displayMessage: "Sign in required to save your messages.",
      };
    }
    return {
      kind: "err",
      status: response.status,
      code,
      displayMessage:
        typeof message === "string" && message.trim().length > 0 ? message : "Could not send your message.",
    };
  }

  return {
    kind: "err",
    status: response.status,
    displayMessage: "Could not send your message. Please try again.",
  };
}
