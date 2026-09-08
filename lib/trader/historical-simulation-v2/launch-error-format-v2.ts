import { redactSensitiveText } from "@/lib/trader/security/redaction";

const MAX_OUTPUT_CHARS = 32_768;
const MAX_ERROR_CHARS = 8_192;
const MAX_DEPTH = 4;
const MAX_ERRORS = 16;

function redactDiagnostic(text: string): string {
  return redactSensitiveText(text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
      "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"'<>]+/gi, "[REDACTED_URL]")
    .replace(/\b(Bearer|Basic)\s+[^\s"']+/gi, "$1 [REDACTED]")
    .replace(/(\b(?:[A-Z_]*(?:PASSWORD|TOKEN|SECRET|PRIVATE_KEY|ACCESS_KEY)[A-Z_]*|apiKey|apiSecret|passphrase)["']?\s*[:=]\s*)(?:"[^"\n]*(?:"|$)|'[^'\n]*(?:'|$)|[^\s,;}]+)/gi,
      "$1[REDACTED]"));
}

// Cause/name/message/aggregate metadata must not execute custom accessors or
// replace the original failure with a getter/proxy failure.
function dataProperty(value: object, key: string, inherited = false): unknown {
  try {
    let current: object | null = value;
    for (let depth = 0; current && depth < (inherited ? 4 : 1); depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
      current = inherited ? Object.getPrototypeOf(current) as object | null : null;
    }
  } catch { /* Unreadable diagnostic metadata must not mask the primary failure. */ }
  return undefined;
}

/** Bounded private diagnostic chain; never enumerates arbitrary error properties or environment. */
export function formatHistoricalLaunchErrorV2(error: unknown): string {
  const seen = new Set<Error>();
  const output: string[] = [];
  let count = 0;
  const visit = (value: unknown, label: string, depth: number): void => {
    if (depth > MAX_DEPTH || count >= MAX_ERRORS) {
      output.push(`${label}: [ERROR_CHAIN_TRUNCATED]`);
      return;
    }
    count += 1;
    let isError = false;
    try { isError = value instanceof Error; } catch { /* hostile proxy */ }
    if (!isError) {
      // Do not stringify arbitrary thrown objects: they may contain full requests/secrets.
      output.push(`${label}: [NON_ERROR_THROW:${typeof value}]`);
      return;
    }
    const errorValue = value as Error;
    if (seen.has(errorValue)) { output.push(`${label}: [ERROR_ALREADY_REPORTED]`); return; }
    seen.add(errorValue);
    // V8 may expose even an assigned native stack through an accessor. Preserve
    // that stack, but contain a custom getter failure and fall back to data fields.
    let stackValue: unknown;
    try { stackValue = errorValue.stack; } catch { /* primary message remains below */ }
    const nameValue = dataProperty(errorValue, "name", true);
    const messageValue = dataProperty(errorValue, "message", true);
    const stack = typeof stackValue === "string" ? stackValue :
      `${typeof nameValue === "string" ? nameValue : "Error"}: ${
        typeof messageValue === "string" ? messageValue : "[ERROR_DETAILS_UNAVAILABLE]"}`;
    output.push(`${label}: ${redactDiagnostic(stack.slice(0, MAX_ERROR_CHARS))}`);
    if (stack.length > MAX_ERROR_CHARS) output.push("[ERROR_STACK_TRUNCATED]");
    const cause = dataProperty(errorValue, "cause");
    if (cause !== undefined) visit(cause, "cause", depth + 1);
    let isAggregate = false;
    try { isAggregate = errorValue instanceof AggregateError; } catch { /* hostile proxy */ }
    const errors = isAggregate ? dataProperty(errorValue, "errors") : undefined;
    let errorArray = false;
    try { errorArray = Array.isArray(errors); } catch { /* revoked proxy */ }
    if (errorArray) {
      const entries = errors as unknown[];
      const length = dataProperty(entries, "length");
      const errorCount = typeof length === "number" && Number.isSafeInteger(length) ? length : 0;
      for (let i = 0; i < Math.min(errorCount, 8); i += 1) {
        visit(dataProperty(entries, String(i)), `errors[${i}]`, depth + 1);
      }
      if (errorCount > 8) output.push("[AGGREGATE_ERRORS_TRUNCATED]");
    }
  };
  visit(error, "error", 0);
  const rendered = output.join("\n");
  return rendered.length <= MAX_OUTPUT_CHARS ? rendered :
    `${rendered.slice(0, MAX_OUTPUT_CHARS - 25)}\n[ERROR_OUTPUT_TRUNCATED]`;
}
