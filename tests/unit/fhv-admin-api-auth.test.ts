import { afterEach, describe, expect, it } from "vitest";

import {
  createFhvAdminCsrfToken,
  fhvAdminCsrfCookieName,
  fhvAdminCsrfHeaderName,
  validateFhvAdminCsrf,
  verifyFhvAdminCsrfToken,
} from "@/lib/trader/fhv-admin-csrf";
import {
  checkFhvAdminCommandRateLimit,
  resetFhvAdminCommandRateLimitsForTests,
} from "@/lib/trader/fhv-admin-rate-limit";
import { FHV_COMMAND_RATE_LIMIT_PER_HOUR } from "@/lib/trader/observability/fhv-observability.constants";

const CSRF_SECRET = "fhv-test-csrf-secret-416";
const OPERATOR_ID = "operator-416";

function buildCsrfRequest(token: string, cookieToken = token): Request {
  return new Request("http://localhost/api/trader/admin/fhv-operations/commands", {
    method: "POST",
    headers: {
      [fhvAdminCsrfHeaderName()]: token,
      cookie: `${fhvAdminCsrfCookieName()}=${cookieToken}`,
    },
  });
}

afterEach(() => {
  resetFhvAdminCommandRateLimitsForTests();
});

describe("DEE-416 FHV admin API auth", () => {
  it("creates and verifies CSRF tokens", () => {
    const token = createFhvAdminCsrfToken(CSRF_SECRET);
    expect(token.split(".")).toHaveLength(2);
    expect(verifyFhvAdminCsrfToken(token, CSRF_SECRET)).toBe(true);
    expect(verifyFhvAdminCsrfToken(token, "wrong-secret")).toBe(false);
  });

  it("validates matching CSRF header and cookie", () => {
    const token = createFhvAdminCsrfToken(CSRF_SECRET);
    expect(validateFhvAdminCsrf(buildCsrfRequest(token), CSRF_SECRET)).toBe(true);
  });

  it("rejects CSRF when header and cookie tokens differ", () => {
    const headerToken = createFhvAdminCsrfToken(CSRF_SECRET);
    const cookieToken = createFhvAdminCsrfToken(CSRF_SECRET);
    expect(validateFhvAdminCsrf(buildCsrfRequest(headerToken, cookieToken), CSRF_SECRET)).toBe(
      false,
    );
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
