import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { computeTreasuryContentDigest } from "@/lib/waia-core/treasury/digest";
import {
  FinanceAssistantError,
  type FinanceAssistantConfirmationPayload,
} from "@/lib/waia-core/finance-assistant/types";

function postgresCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

export async function consumeFinanceAssistantConfirmation(
  runtime: WaiaRuntimeDb,
  payload: FinanceAssistantConfirmationPayload,
  now: Date = new Date(),
): Promise<void> {
  if (runtime.kind !== "postgres") {
    throw new FinanceAssistantError(
      "ASSISTANT_CONFIRMATION_STORE_NOT_READY",
      "Finance Assistant writes require the Postgres confirmation store.",
    );
  }
  try {
    await runtime.db.insert(pgSchema.treasuryFinanceAssistantConfirmations).values({
      id: crypto.randomUUID(),
      organizationId: payload.organizationId,
      subjectUserId: payload.subjectUserId,
      intent: payload.intent,
      nonceDigest: computeTreasuryContentDigest(payload.nonce),
      fieldsDigest: computeTreasuryContentDigest(payload.fields),
      issuedAt: new Date(payload.issuedAt * 1_000),
      expiresAt: new Date(payload.expiresAt * 1_000),
      consumedAt: now,
    });
  } catch (error) {
    if (postgresCode(error) === "23505") {
      throw new FinanceAssistantError(
        "ASSISTANT_CONFIRMATION_ALREADY_USED",
        "This confirmation was already used. Submit the request again for a new preview.",
      );
    }
    if (postgresCode(error) === "42P01") {
      throw new FinanceAssistantError(
        "ASSISTANT_CONFIRMATION_STORE_NOT_READY",
        "Finance Assistant write confirmation is not activated.",
      );
    }
    throw error;
  }
}
