/**
 * AI Gateway foundation kill-switch / opt-in (DEE-77).
 *
 * Default (unset): legacy inline stub path in callers — preserves pre-gateway behavior.
 * Truthy: route Twin dialogue assistant text through gateway + {@link FakeCompletionProvider}.
 */

export function isWaiaAiGatewayFoundationEnabled(): boolean {
  const raw = process.env.WAIA_AI_GATEWAY_FOUNDATION;
  if (raw === undefined || raw === "") {
    return false;
  }
  const v = raw.trim().toLowerCase();
  // Explicit allowlist only — unknown values stay disabled (safe default).
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
