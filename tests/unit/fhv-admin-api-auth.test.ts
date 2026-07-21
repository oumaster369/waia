import { afterEach, describe, expect, it } from "vitest";

import {
  FHV_ADMIN_CSRF_COOKIE,
  FHV_ADMIN_CSRF_HEADER,
  buildFhvAdminCsrfSetCookieHeader,
  createFhvAdminCsrfToken,
  validateFhvAdminCsrf,
  verifyFhvAdminCsrfToken,
} from "@/lib/trader/fhv-admin-csrf";
import {
  checkFhvAdminCommandRateLimit,
  resetFhvAdminCommandRateLimitsForTests,
} from "@/lib/trader/fhv-admin-rate-limit";
import { FHV_COMMAND_RATE_LIMIT_PER_HOUR } from "@/lib/trader/observability/fhv-observability.constants";

const CSRF_SECRET = "fhv-test-csrf-secret-416";
const ORG_A = "00000000-0000-4000-8000-0000000416a1";
const ORG_B = "00000000-0000-4000-8000-0000000416b2";
const OPERATOR_ID = "operator-416";

function buildCsrfRequest(token: string, organizationId: string, cookieToken = token): Request {
  return new Request(
    `http://localhost/api/trader/admin/fhv-operations/commands?organization_id=${organizationId}`,
    {
      method: "POST",
      headers: {
        [FHV_ADMIN_CSRF_HEADER]: token,
        cookie: `${FHV_ADMIN_CSRF_COOKIE}=${encodeURIComponent(cookieToken)}`,
      },
    },
  );
}

afterEach(() => {
  resetFhvAdminCommandRateLimitsForTests();
});

describe("DEE-416 FHV admin API auth", () => {
  it("creates and verifies organization- and operator-bound CSRF tokens", () => {
    const token = createFhvAdminCsrfToken(CSRF_SECRET, ORG_A, OPERATOR_ID);
    expect(token.split(".")).toHaveLength(2);
    expect(
      verifyFhvAdminCsrfToken({
        token,
        secret: CSRF_SECRET,
        organizationId: ORG_A,
        operatorId: OPERATOR_ID,
      }),
    ).toBe(true);
    expect(
      verifyFhvAdminCsrfToken({
        token,
        secret: CSRF_SECRET,
        organizationId: ORG_B,
        operatorId: OPERATOR_ID,
      }),
    ).toBe(false);
    expect(
      verifyFhvAdminCsrfToken({
        token,
        secret: "wrong-secret",
        organizationId: ORG_A,
        operatorId: OPERATOR_ID,
      }),
    ).toBe(false);
  });

  it("rejects CSRF when operator binding does not match", () => {
    const token = createFhvAdminCsrfToken(CSRF_SECRET, ORG_A, OPERATOR_ID);
    expect(
      verifyFhvAdminCsrfToken({
        token,
        secret: CSRF_SECRET,
        organizationId: ORG_A,
        operatorId: "other-operator",
      }),
    ).toBe(false);
  });

  it("rejects expired CSRF tokens", () => {
    const nowMs = Date.parse("2026-07-21T12:00:00.000Z");
    const token = createFhvAdminCsrfToken(CSRF_SECRET, ORG_A, OPERATOR_ID, nowMs);
    expect(
      verifyFhvAdminCsrfToken({
        token,
        secret: CSRF_SECRET,
        organizationId: ORG_A,
        operatorId: OPERATOR_ID,
        nowMs: nowMs + 2 * 60 * 60 * 1000,
      }),
    ).toBe(false);
  });

  it("validates matching CSRF header and cookie for the same organization and operator", () => {
    const token = createFhvAdminCsrfToken(CSRF_SECRET, ORG_A, OPERATOR_ID);
    expect(
      validateFhvAdminCsrf(buildCsrfRequest(token, ORG_A), CSRF_SECRET, ORG_A, OPERATOR_ID),
    ).toBe(true);
  });

  it("rejects CSRF when header and cookie tokens differ", () => {
    const headerToken = createFhvAdminCsrfToken(CSRF_SECRET, ORG_A, OPERATOR_ID);
    const cookieToken = createFhvAdminCsrfToken(CSRF_SECRET, ORG_A, OPERATOR_ID);
    expect(
      validateFhvAdminCsrf(
        buildCsrfRequest(headerToken, ORG_A, cookieToken),
        CSRF_SECRET,
        ORG_A,
        OPERATOR_ID,
      ),
    ).toBe(false);
  });

  it("rejects CSRF when organization binding does not match", () => {
    const token = createFhvAdminCsrfToken(CSRF_SECRET, ORG_A, OPERATOR_ID);
    expect(
      validateFhvAdminCsrf(buildCsrfRequest(token, ORG_A), CSRF_SECRET, ORG_B, OPERATOR_ID),
    ).toBe(false);
  });

  it("builds Set-Cookie without exposing secrets in the header value", () => {
    const token = createFhvAdminCsrfToken(CSRF_SECRET, ORG_A, OPERATOR_ID);
    const header = buildFhvAdminCsrfSetCookieHeader(token, true);
    expect(header).toContain(`${FHV_ADMIN_CSRF_COOKIE}=`);
    expect(header).toContain("Secure");
    expect(header).not.toContain(CSRF_SECRET);
  });

  it("enforces per-operator command rate limit", () => {
    const startMs = Date.parse("2026-07-21T12:00:00.000Z");
    for (let index = 0; index < FHV_COMMAND_RATE_LIMIT_PER_HOUR; index += 1) {
      const result = checkFhvAdminCommandRateLimit(OPERATOR_ID, startMs + index);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(FHV_COMMAND_RATE_LIMIT_PER_HOUR - index - 1);
    }
    const blocked = checkFhvAdminCommandRateLimit(
      OPERATOR_ID,
      startMs + FHV_COMMAND_RATE_LIMIT_PER_HOUR,
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });
});
