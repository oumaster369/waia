import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const FHV_ADMIN_CSRF_COOKIE = "fhv_admin_csrf";
export const FHV_ADMIN_CSRF_HEADER = "x-fhv-csrf-token";
export const FHV_ADMIN_CSRF_MAX_AGE_SEC = 60 * 60;

export function createFhvAdminCsrfToken(secret: string, organizationId: string): string {
  const nonce = randomBytes(16).toString("hex");
  const payload = `${organizationId}:${nonce}`;
  const signature = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  return `${organizationId}.${nonce}.${signature}`;
}

export function verifyFhvAdminCsrfToken(
  token: string,
  secret: string,
  organizationId: string,
): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }
  const [tokenOrg, nonce, signature] = parts;
  if (!tokenOrg || !nonce || !signature || tokenOrg !== organizationId) {
    return false;
  }
  const payload = `${organizationId}:${nonce}`;
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildFhvAdminCsrfSetCookieHeader(token: string, secure: boolean): string {
  const segments = [
    `${FHV_ADMIN_CSRF_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "SameSite=Strict",
    `Max-Age=${FHV_ADMIN_CSRF_MAX_AGE_SEC}`,
  ];
  if (secure) {
    segments.push("Secure");
  }
  return segments.join("; ");
}

export function extractFhvAdminCsrfFromRequest(request: Request): string | null {
  return request.headers.get(FHV_ADMIN_CSRF_HEADER)?.trim() || null;
}

export function extractFhvAdminCsrfCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const raw = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${FHV_ADMIN_CSRF_COOKIE}=`))
    ?.slice(FHV_ADMIN_CSRF_COOKIE.length + 1);
  return raw ? decodeURIComponent(raw) : null;
}

export function validateFhvAdminCsrf(
  request: Request,
  secret: string,
  organizationId: string,
): boolean {
  const headerToken = extractFhvAdminCsrfFromRequest(request);
  const cookieToken = extractFhvAdminCsrfCookie(request);
  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    return false;
  }
  return verifyFhvAdminCsrfToken(headerToken, secret, organizationId);
}

/** @deprecated use FHV_ADMIN_CSRF_COOKIE */
export const fhvAdminCsrfCookieName = (): string => FHV_ADMIN_CSRF_COOKIE;
/** @deprecated use FHV_ADMIN_CSRF_HEADER */
export const fhvAdminCsrfHeaderName = (): string => FHV_ADMIN_CSRF_HEADER;
