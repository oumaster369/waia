/**
 * Optional cross-subdomain cookie domain (production-only).
 * NOT the WAIA SSO strategy — revert by unsetting WAIA_COOKIE_DOMAIN.
 */
export function resolveWaiaCookieDomain(): string | undefined {
  if (process.env.NODE_ENV !== "production") {
    return undefined;
  }

  const raw = process.env.WAIA_COOKIE_DOMAIN?.trim();
  if (!raw) {
    return undefined;
  }

  const lower = raw.toLowerCase();
  if (lower.includes("localhost")) {
    return undefined;
  }

  return raw;
}
