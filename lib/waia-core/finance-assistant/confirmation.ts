import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import {
  FINANCE_ASSISTANT_INTENTS,
  FinanceAssistantError,
  FINANCE_ASSISTANT_CONFIRMATION_TTL_SECONDS,
  type FinanceAssistantConfirmationPayload,
  type FinanceAssistantWriteIntent,
} from "@/lib/waia-core/finance-assistant/types";
import { isWriteIntent } from "@/lib/waia-core/finance-assistant/planner";

const writeIntents = new Set<FinanceAssistantWriteIntent>(
  FINANCE_ASSISTANT_INTENTS.filter(isWriteIntent),
);

function encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(value, "base64url"));
}
async function key(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createFinanceConfirmation(input: {
  userId: string;
  organizationId: string;
  intent: FinanceAssistantWriteIntent;
  fields: Record<string, string | null>;
  now?: Date;
  secret?: string;
}): Promise<string> {
  const secret =
    input.secret ?? process.env.WAIA_FINANCE_ASSISTANT_CONFIRMATION_SECRET?.trim() ?? "";
  if (secret.length < 32)
    throw new FinanceAssistantError(
      "ASSISTANT_CONFIRMATION_NOT_CONFIGURED",
      "Finance Assistant confirmation is not configured.",
    );
  const now = input.now ?? new Date();
  const payload: FinanceAssistantConfirmationPayload = {
    version: 1,
    subjectUserId: input.userId,
    organizationId: input.organizationId,
    intent: input.intent,
    fields: input.fields,
    issuedAt: Math.floor(now.getTime() / 1000),
    expiresAt: Math.floor(now.getTime() / 1000) + FINANCE_ASSISTANT_CONFIRMATION_TTL_SECONDS,
    nonce: crypto.randomUUID(),
  };
  const encoded = encode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = encode(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(encoded)),
    ),
  );
  return `${encoded}.${signature}`;
}

export async function verifyFinanceConfirmation(
  token: string,
  input: { userId: string; organizationId: string; now?: Date; secret?: string },
): Promise<FinanceAssistantConfirmationPayload> {
  const secret =
    input.secret ?? process.env.WAIA_FINANCE_ASSISTANT_CONFIRMATION_SECRET?.trim() ?? "";
  if (secret.length < 32)
    throw new FinanceAssistantError(
      "ASSISTANT_CONFIRMATION_NOT_CONFIGURED",
      "Finance Assistant confirmation is not configured.",
    );
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra)
    throw new FinanceAssistantError("INVALID_CONFIRMATION", "Confirmation token is invalid.");
  const valid = await crypto.subtle.verify(
    "HMAC",
    await key(secret),
    decode(signature),
    new TextEncoder().encode(encoded),
  );
  if (!valid)
    throw new FinanceAssistantError("INVALID_CONFIRMATION", "Confirmation token is invalid.");
  let payload: FinanceAssistantConfirmationPayload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(decode(encoded)),
    ) as FinanceAssistantConfirmationPayload;
  } catch {
    throw new FinanceAssistantError("INVALID_CONFIRMATION", "Confirmation token is invalid.");
  }
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const fieldsAreValid =
    payload.fields !== null &&
    typeof payload.fields === "object" &&
    !Array.isArray(payload.fields) &&
    Object.values(payload.fields).every((value) => value === null || typeof value === "string");
  if (
    payload.version !== 1 ||
    typeof payload.subjectUserId !== "string" ||
    typeof payload.organizationId !== "string" ||
    !writeIntents.has(payload.intent) ||
    !fieldsAreValid ||
    typeof payload.nonce !== "string" ||
    payload.nonce.length === 0 ||
    !Number.isFinite(payload.issuedAt) ||
    !Number.isFinite(payload.expiresAt) ||
    payload.subjectUserId !== input.userId ||
    payload.organizationId !== input.organizationId ||
    payload.expiresAt < now ||
    payload.issuedAt > now + 30
  )
    throw new FinanceAssistantError(
      "INVALID_CONFIRMATION",
      "Confirmation token is expired or outside the current scope.",
    );
  return payload;
}
