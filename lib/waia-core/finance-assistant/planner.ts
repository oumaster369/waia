import {
  FINANCE_ASSISTANT_MAX_MESSAGE_CHARS,
  FINANCE_ASSISTANT_INTENTS,
  FinanceAssistantError,
  type FinanceAssistantIntentName,
  type FinanceAssistantPlan,
} from "@/lib/waia-core/finance-assistant/types";

export const FINANCE_ASSISTANT_FIELD_NAMES = [
  "displayName",
  "websiteUrl",
  "email",
  "phone",
  "paymentInstructions",
  "waiaUsername",
  "kind",
  "currency",
  "network",
  "address",
  "maskedRequisites",
  "watchedAddressId",
  "name",
  "groupName",
  "description",
  "monthlyBudget",
  "startsOn",
  "endsOn",
  "signedAmount",
  "status",
  "counterpartyId",
  "counterpartyName",
  "accountId",
  "accountName",
  "categoryId",
  "categoryName",
  "projectId",
  "projectName",
  "notes",
  "occurredAt",
  "correctsTransactionId",
  "targetId",
  "targetName",
  "newName",
  "isActive",
  "effectiveMonth",
  "transactionId",
  "duplicateOfTransactionId",
  "originalTransactionId",
  "correctionTransactionId",
  "toStatus",
  "purpose",
  "confirmedBalance",
  "asOf",
  "note",
  "reason",
  "detailPublication",
  "supersededById",
  "breathEnabled",
  "stageLabel",
  "workSummary",
  "methodologyNote",
  "recentActivityLimit",
  "tokenContract",
  "assetCode",
  "directionScope",
  "includeInBalanceRecon",
  "label",
] as const;

const INTENTS = new Set<string>(FINANCE_ASSISTANT_INTENTS);
const FIELDS = new Set<string>(FINANCE_ASSISTANT_FIELD_NAMES);

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string")
    throw new FinanceAssistantError("INVALID_MODEL_OUTPUT", `${field} must be a string or null`);
  const trimmed = value.trim();
  if (trimmed.length > 2_000)
    throw new FinanceAssistantError("INVALID_MODEL_OUTPUT", `${field} is too long`);
  return trimmed || null;
}

export function parseFinanceAssistantPlan(
  input: unknown,
  metadata: { requestId?: string; model: string },
): FinanceAssistantPlan {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new FinanceAssistantError("INVALID_MODEL_OUTPUT", "Planner output must be an object");
  const row = input as Record<string, unknown>;
  if (typeof row.intent !== "string" || !INTENTS.has(row.intent))
    throw new FinanceAssistantError("INVALID_MODEL_OUTPUT", "Planner intent is not permitted");
  const summary = nullableString(row.summary, "summary");
  if (!summary)
    throw new FinanceAssistantError("INVALID_MODEL_OUTPUT", "Planner summary is required");
  if (row.language !== "ru" && row.language !== "en")
    throw new FinanceAssistantError("INVALID_MODEL_OUTPUT", "Planner language is invalid");
  const language = row.language;
  const question = nullableString(row.question, "question");
  if (!row.fields || typeof row.fields !== "object" || Array.isArray(row.fields))
    throw new FinanceAssistantError("INVALID_MODEL_OUTPUT", "Planner fields are required");
  const rawFields = row.fields as Record<string, unknown>;
  if (Object.keys(rawFields).some((key) => !FIELDS.has(key)))
    throw new FinanceAssistantError("INVALID_MODEL_OUTPUT", "Planner returned an unknown field");
  const fields: Record<string, string | null> = {};
  for (const field of FINANCE_ASSISTANT_FIELD_NAMES)
    fields[field] = nullableString(rawFields[field], field);
  return {
    intent: row.intent as FinanceAssistantIntentName,
    summary,
    language,
    question,
    fields,
    providerRequestId: metadata.requestId ?? null,
    model: metadata.model,
  };
}

export function isReportIntent(intent: FinanceAssistantIntentName): boolean {
  return (
    intent === "REPORT_OVERVIEW" ||
    intent === "REPORT_BUDGET" ||
    intent === "REPORT_TRANSACTIONS" ||
    intent === "REPORT_WALLET"
  );
}

export function isWriteIntent(
  intent: FinanceAssistantIntentName,
): intent is Exclude<
  FinanceAssistantIntentName,
  "REPORT_OVERVIEW" | "REPORT_BUDGET" | "REPORT_TRANSACTIONS" | "REPORT_WALLET" | "UNSUPPORTED"
> {
  return !isReportIntent(intent) && intent !== "UNSUPPORTED";
}

const SENSITIVE_PROMPT_PATTERNS = [
  /\bprivate[ _-]?key\b/i,
  /\bseed[ _-]?phrase\b/i,
  /\bmnemonic\b/i,
  /\b(?:password|passphrase|cvv|cvc|pin)\b/i,
  /\b(?:\d[ -]?){13,19}\b/,
] as const;

export function requireSafeFinanceAssistantMessage(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new FinanceAssistantError("MESSAGE_REQUIRED", "Enter a Finance request.");
  }
  const message = value.trim();
  if (message.length > FINANCE_ASSISTANT_MAX_MESSAGE_CHARS) {
    throw new FinanceAssistantError(
      "MESSAGE_TOO_LONG",
      "Finance requests are limited to 4,000 characters.",
    );
  }
  if (SENSITIVE_PROMPT_PATTERNS.some((pattern) => pattern.test(message))) {
    throw new FinanceAssistantError(
      "SENSITIVE_CONTENT_REJECTED",
      "Do not enter passwords, card numbers, seed phrases, or private keys.",
    );
  }
  return message;
}
