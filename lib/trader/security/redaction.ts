/** Substrings that must never appear in client-facing errors or telemetry. */
const SENSITIVE_QUERY_KEYS = [
  "AccessKeyId",
  "Signature",
  "apiSecret",
  "apiKey",
  "secret",
  "passphrase",
  "client-order-id",
] as const;

const BASE64_LIKE = /\b[A-Za-z0-9+/]{32,}={0,2}\b/g;
const KEY_VALUE_SENSITIVE = new RegExp(
  `(${SENSITIVE_QUERY_KEYS.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})=([^&\\s"']+)`,
  "gi",
);

/** Redact credential-like material from free-form text (logs, errors, telemetry). */
export function redactSensitiveText(text: string): string {
  let redacted = text.replace(KEY_VALUE_SENSITIVE, "$1=[REDACTED]");
  redacted = redacted.replace(BASE64_LIKE, "[REDACTED]");
  return redacted;
}

/** Return a client-safe error message that cannot contain raw credential material. */
export function sanitizeClientErrorMessage(message: string): string {
  return redactSensitiveText(message);
}

/** True when text appears to contain credential or signature material. */
export function containsSensitiveCredentialMaterial(text: string): boolean {
  return redactSensitiveText(text) !== text;
}
