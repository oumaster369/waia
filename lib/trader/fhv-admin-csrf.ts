import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { FHV_ADMIN_CSRF_MAX_TTL_MS } from "@/lib/trader/observability/fhv-observability.constants";
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export const FHV_ADMIN_CSRF_COOKIE = "fhv_admin_csrf";
export const FHV_ADMIN_CSRF_HEADER = "x-fhv-csrf-token";
export const FHV_ADMIN_CSRF_SCHEMA_VERSION = "fhv-admin-csrf/v2" as const;
export const FHV_ADMIN_CSRF_MAX_AGE_SEC = 60 * 60;
export const FHV_ADMIN_CSRF_MAX_FUTURE_SKEW_MS = 60_000;

export type FhvAdminCsrfPayload = Readonly<{
  schemaVersion: typeof FHV_ADMIN_CSRF_SCHEMA_VERSION;
  organizationId: string;
  operatorId: string;
  issuedAtUtc: string;
  expiresAtUtc: string;
  nonce: string;
}>;

function encodePayload(payload: FhvAdminCsrfPayload): string {
  return Buffer.from(canonicalizeSemanticJsonString(payload), "utf8").toString("base64url");
}

function decodePayload(encoded: string): FhvAdminCsrfPayload | null {
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    return JSON.parse(json) as FhvAdminCsrfPayload;
  } catch {
    return null;
  }
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload, "utf8").digest("hex");
}

export function createFhvAdminCsrfToken(
  secret: string,
  organizationId: string,
  operatorId: string,
  nowMs = Date.now(),
): string {
  const payload: FhvAdminCsrfPayload = {
    schemaVersion: FHV_ADMIN_CSRF_SCHEMA_VERSION,
    organizationId,
    operatorId,
    issuedAtUtc: new Date(nowMs).toISOString(),
    expiresAtUtc: new Date(nowMs + FHV_ADMIN_CSRF_MAX_TTL_MS).toISOString(),
    nonce: randomBytes(16).toString("hex"),
  };
  const encoded = encodePayload(payload);
  return `${encoded}.${signPayload(encoded, secret)}`;
}

export function verifyFhvAdminCsrfToken(input: {
  token: string;
  secret: string;
  organizationId: string;
  operatorId: string;
  nowMs?: number;
}): boolean {
  const parts = input.token.split(".");
  if (parts.length !== 2) {
    return false;
  }
  const [encoded, signature] = parts;
  if (!encoded || !signature) {
    return false;
  }
  const expected = signPayload(encoded, input.secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return false;
  }
  const payload = decodePayload(encoded);
  if (!payload) {
    return false;
  }
  if (payload.schemaVersion !== FHV_ADMIN_CSRF_SCHEMA_VERSION) {
    return false;
  }
  if (payload.organizationId !== input.organizationId || payload.operatorId !== input.operatorId) {
    return false;
  }
  const issuedMs = Date.parse(payload.issuedAtUtc);
  const expiresMs = Date.parse(payload.expiresAtUtc);
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)) {
    return false;
  }
  if (issuedMs - nowMs > FHV_ADMIN_CSRF_MAX_FUTURE_SKEW_MS) {
    return false;
  }
  if (expiresMs <= issuedMs || expiresMs - issuedMs > FHV_ADMIN_CSRF_MAX_TTL_MS) {
    return false;
  }
  if (expiresMs < nowMs) {
    return false;
  }
  return true;
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
  operatorId: string,
): boolean {
  const headerToken = extractFhvAdminCsrfFromRequest(request);
  const cookieToken = extractFhvAdminCsrfCookie(request);
  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    return false;
  }
  return verifyFhvAdminCsrfToken({
    token: headerToken,
    secret,
    organizationId,
    operatorId,
  });
}

/** @deprecated use FHV_ADMIN_CSRF_COOKIE */
export const fhvAdminCsrfCookieName = (): string => FHV_ADMIN_CSRF_COOKIE;
/** @deprecated use FHV_ADMIN_CSRF_HEADER */
export const fhvAdminCsrfHeaderName = (): string => FHV_ADMIN_CSRF_HEADER;
