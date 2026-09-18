export const BILLING_V2_MODULE_ROOT = "lib/trader/billing/v2" as const;

export const BILLING_V2_FORBIDDEN_IMPORT_PREFIXES = [
  "@/lib/trader/execution/",
  "@/lib/trader/live/",
  "@/lib/trader/connectors/",
] as const;

export const BILLING_V2_FORBIDDEN_CONNECTOR_DISPATCH =
  "@/lib/trader/execution/v2/connector-dispatch";

const MODULE_SPECIFIER = /(?:from|import)\s+["']([^"']+)["']/g;

export function billingV2SourceHasForbiddenVenueWrite(source: string): boolean {
  if (/\.placeOrder\s*\(/.test(source)) {
    return true;
  }
  for (const match of source.matchAll(MODULE_SPECIFIER)) {
    const specifier = match[1];
    if (!specifier) continue;
    if (specifier === BILLING_V2_FORBIDDEN_CONNECTOR_DISPATCH) {
      return true;
    }
    if (BILLING_V2_FORBIDDEN_IMPORT_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
      return true;
    }
  }
  return false;
}
