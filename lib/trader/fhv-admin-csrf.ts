import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const CSRF_COOKIE = "fhv_admin_csrf";
const CSRF_HEADER = "x-fhv-csrf-token";

export function createFhvAdminCsrfToken(secret: string): string {
  const nonce = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", secret).update(nonce, "utf8").digest("hex");
  return `${nonce}.${signature}`;
}

export function verifyFhvAdminCsrfToken(token: string, secret: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return false;
  }
  const [nonce, signature] = parts;
  if (!nonce || !signature) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(nonce, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function extractFhvAdminCsrfFromRequest(request: Request): string | null {
  return request.headers.get(CSRF_HEADER)?.trim() || null;
}

export function fhvAdminCsrfCookieName(): string {
  return CSRF_COOKIE;
}

export function fhvAdminCsrfHeaderName(): string {
  return CSRF_HEADER;
}

export function validateFhvAdminCsrf(request: Request, secret: string): boolean {
  const headerToken = extractFhvAdminCsrfFromRequest(request);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieToken = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CSRF_COOKIE}=`))
    ?.slice(CSRF_COOKIE.length + 1);
  if (!headerToken || !cookieToken) {
    return false;
  }
  if (headerToken !== cookieToken) {
    return false;
  }
  return verifyFhvAdminCsrfToken(headerToken, secret);
}
